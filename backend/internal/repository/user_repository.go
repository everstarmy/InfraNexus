package repository

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"infranexus/internal/domain"
)

type userRepository struct {
	*BaseRepository[domain.User, uuid.UUID]
}

func NewUserRepository(db *gorm.DB) domain.UserRepository {
	return &userRepository{
		BaseRepository: NewBaseRepository[domain.User, uuid.UUID](db),
	}
}

func (r *userRepository) withRelations(ctx context.Context) *gorm.DB {
	return r.DB(ctx).Preload("Roles").Preload("Department")
}

func (r *userRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	var user domain.User
	if err := r.withRelations(ctx).First(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByUsername(ctx context.Context, authDomain, username string) (*domain.User, error) {
	var user domain.User
	if err := r.withRelations(ctx).First(&user, "domain = ? AND username = ?", authDomain, username).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	var user domain.User
	if err := r.withRelations(ctx).First(&user, "email = ?", email).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByExternalID(ctx context.Context, authDomain, externalID string) (*domain.User, error) {
	var user domain.User
	if err := r.withRelations(ctx).First(&user, "domain = ? AND external_id = ?", authDomain, externalID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) ListByDomain(ctx context.Context, authDomain string) ([]domain.User, error) {
	var users []domain.User
	err := r.DB(ctx).Where("domain = ?", authDomain).Find(&users).Error
	return users, err
}

func (r *userRepository) FindByIDs(ctx context.Context, ids []uuid.UUID) ([]domain.User, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var users []domain.User
	err := r.DB(ctx).Where("id IN ?", ids).Find(&users).Error
	return users, err
}

var userSortColumns = map[string]string{
	"username":      "users.username",
	"nickname":      "users.nickname",
	"email":         "users.email",
	"status":        "users.status",
	"created_at":    "users.created_at",
	"last_login_at": "users.last_login_at",
}

func userOrder(sort string) string {
	key, dir, _ := strings.Cut(sort, ":")
	column, ok := userSortColumns[key]
	if !ok {
		return "users.created_at DESC, users.id ASC"
	}
	if strings.EqualFold(dir, "asc") {
		return column + " ASC, users.id ASC"
	}
	return column + " DESC, users.id ASC"
}

func (r *userRepository) Search(ctx context.Context, f domain.UserFilter) ([]domain.User, int64, error) {
	var users []domain.User
	var total int64

	query := r.DB(ctx).Model(&domain.User{})

	if f.Keyword != "" {
		likePattern := "%" + f.Keyword + "%"
		query = query.Where("users.username LIKE ? OR users.email LIKE ? OR users.nickname LIKE ?", likePattern, likePattern, likePattern)
	}
	if len(f.Statuses) > 0 {
		query = query.Where("users.status IN ?", f.Statuses)
	}
	if len(f.AuthTypes) > 0 {
		query = query.Where("users.auth_type IN ?", f.AuthTypes)
	}
	if len(f.RoleIDs) > 0 {
		query = query.Where("EXISTS (SELECT 1 FROM sys_user_roles ur WHERE ur.user_id = users.id AND ur.role_id IN ?)", f.RoleIDs)
	}
	switch {
	case f.NoDepartment:
		query = query.Where("users.department_id IS NULL")
	case f.DepartmentIDs != nil && len(f.DepartmentIDs) == 0:
		query = query.Where("1 = 0")
	case f.DepartmentIDs != nil:
		query = query.Where("users.department_id IN ?", f.DepartmentIDs)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if f.Page > 0 && f.PageSize > 0 {
		query = query.Offset((f.Page - 1) * f.PageSize).Limit(f.PageSize)
	}

	if err := query.Preload("Roles").Preload("Department").Order(userOrder(f.Sort)).Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func (r *userRepository) AssignRoles(ctx context.Context, userID uuid.UUID, roleIDs []uuid.UUID) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		var user domain.User
		if err := tx.First(&user, "id = ?", userID).Error; err != nil {
			return err
		}

		var roles []domain.Role
		if len(roleIDs) > 0 {
			if err := tx.Where("id IN ?", roleIDs).Find(&roles).Error; err != nil {
				return err
			}
			if len(roles) != len(roleIDs) {
				return gorm.ErrRecordNotFound
			}
		}

		return tx.Model(&user).Association("Roles").Replace(roles)
	})
}

func (r *userRepository) CreateWithRoles(ctx context.Context, user *domain.User, roleIDs []uuid.UUID) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		if len(roleIDs) == 0 {
			return nil
		}
		var roles []domain.Role
		if err := tx.Where("id IN ?", roleIDs).Find(&roles).Error; err != nil {
			return err
		}
		if len(roles) != len(roleIDs) {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(user).Association("Roles").Append(roles)
	})
}

func (r *userRepository) UpdateColumns(ctx context.Context, id uuid.UUID, values map[string]any) error {
	updates := make(map[string]any, len(values)+2)
	for key, value := range values {
		updates[key] = value
	}
	_, onlyLoginTimestamp := values["last_login_at"]
	if !onlyLoginTimestamp || len(values) > 1 {
		updates["edit_revision"] = gorm.Expr("edit_revision + 1")
	}
	if status, ok := values["status"].(int); ok && status == domain.StatusDisabled {
		updates["auth_version"] = gorm.Expr("auth_version + CASE WHEN status <> ? THEN 1 ELSE 0 END", domain.StatusDisabled)
	}
	if _, ok := values["password"]; ok {
		updates["auth_version"] = gorm.Expr("auth_version + 1")
	}
	result := r.DB(ctx).Model(&domain.User{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *userRepository) UpdateColumnsCAS(ctx context.Context, id uuid.UUID, expectedRevision int64, values map[string]any) error {
	updates := make(map[string]any, len(values)+1)
	for key, value := range values {
		updates[key] = value
	}
	updates["edit_revision"] = gorm.Expr("edit_revision + 1")
	if status, ok := values["status"].(int); ok && status == domain.StatusDisabled {
		updates["auth_version"] = gorm.Expr("auth_version + CASE WHEN status <> ? THEN 1 ELSE 0 END", domain.StatusDisabled)
	}
	result := r.DB(ctx).Model(&domain.User{}).
		Where("id = ? AND edit_revision = ?", id, expectedRevision).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var user domain.User
		if err := r.DB(ctx).Select("id").First(&user, "id = ?", id).Error; err != nil {
			return err
		}
		return domain.ErrEditRevisionConflict
	}
	return nil
}

func (r *userRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status int, expectedRevision int64) error {
	result := r.DB(ctx).Model(&domain.User{}).
		Where("id = ? AND edit_revision = ?", id, expectedRevision).
		Updates(map[string]any{
			"status":        status,
			"edit_revision": gorm.Expr("edit_revision + 1"),
			"auth_version":  gorm.Expr("auth_version + CASE WHEN status <> ? AND ? = ? THEN 1 ELSE 0 END", domain.StatusDisabled, status, domain.StatusDisabled),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var user domain.User
		if err := r.DB(ctx).Select("id").First(&user, "id = ?", id).Error; err != nil {
			return err
		}
		return domain.ErrEditRevisionConflict
	}
	return nil
}

func (r *userRepository) MoveToDepartment(ctx context.Context, userIDs []uuid.UUID, deptID uuid.UUID) (int64, error) {
	tx := r.DB(ctx)
	var lockedIDs []uuid.UUID
	if err := tx.Model(&domain.User{}).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").
		Where("id IN ?", userIDs).
		Order("id ASC").
		Find(&lockedIDs).Error; err != nil {
		return 0, err
	}
	if len(lockedIDs) != len(userIDs) {
		return 0, gorm.ErrRecordNotFound
	}
	result := tx.Model(&domain.User{}).
		Where("id IN ?", lockedIDs).
		Updates(map[string]any{"department_id": deptID, "edit_revision": gorm.Expr("edit_revision + 1")})
	if result.Error != nil {
		return result.RowsAffected, result.Error
	}
	if result.RowsAffected != int64(len(userIDs)) {
		return result.RowsAffected, gorm.ErrRecordNotFound
	}
	return result.RowsAffected, nil
}

func (r *userRepository) CountByDepartmentIDs(ctx context.Context, deptIDs []uuid.UUID) (int64, error) {
	if len(deptIDs) == 0 {
		return 0, nil
	}
	var count int64
	err := r.DB(ctx).Model(&domain.User{}).Where("department_id IN ?", deptIDs).Count(&count).Error
	return count, err
}

func (r *userRepository) MemberCounts(ctx context.Context) (map[uuid.UUID]int64, error) {
	var rows []struct {
		DepartmentID uuid.UUID
		Count        int64
	}
	err := r.DB(ctx).Model(&domain.User{}).
		Select("department_id, COUNT(*) AS count").
		Where("department_id IS NOT NULL").
		Group("department_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[uuid.UUID]int64, len(rows))
	for _, row := range rows {
		counts[row.DepartmentID] = row.Count
	}
	return counts, nil
}

func (r *userRepository) Stats(ctx context.Context) (*domain.UserStats, error) {
	var totals struct {
		Total      int64
		Active     int64
		Disabled   int64
		Local      int64
		Directory  int64
		Unassigned int64
	}
	err := r.DB(ctx).Model(&domain.User{}).Select(`COUNT(*) AS total,
		COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active,
		COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0) AS disabled,
		COALESCE(SUM(CASE WHEN auth_type = 'local' THEN 1 ELSE 0 END), 0) AS local,
		COALESCE(SUM(CASE WHEN auth_type <> 'local' THEN 1 ELSE 0 END), 0) AS directory,
		COALESCE(SUM(CASE WHEN department_id IS NULL THEN 1 ELSE 0 END), 0) AS unassigned`).
		Scan(&totals).Error
	if err != nil {
		return nil, err
	}
	stats := domain.UserStats{
		Total:      totals.Total,
		Active:     totals.Active,
		Disabled:   totals.Disabled,
		Local:      totals.Local,
		Directory:  totals.Directory,
		Unassigned: totals.Unassigned,
		ByDomain:   []domain.DomainCount{},
	}
	err = r.DB(ctx).Model(&domain.User{}).
		Select("domain, auth_type, COUNT(*) AS count").
		Where("auth_type <> ?", domain.AuthTypeLocal).
		Group("domain, auth_type").
		Order("count DESC").
		Scan(&stats.ByDomain).Error
	if err != nil {
		return nil, err
	}
	return &stats, nil
}

func (r *userRepository) EmailOwners(ctx context.Context) (map[string]uuid.UUID, error) {
	var rows []struct {
		ID    uuid.UUID
		Email string
	}
	if err := r.DB(ctx).Model(&domain.User{}).Select("id, email").Where("email <> ''").Scan(&rows).Error; err != nil {
		return nil, err
	}
	owners := make(map[string]uuid.UUID, len(rows))
	for _, row := range rows {
		owners[strings.ToLower(row.Email)] = row.ID
	}
	return owners, nil
}
