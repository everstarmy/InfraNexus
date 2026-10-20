package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type roleRepository struct {
	*BaseRepository[domain.Role, uuid.UUID]
}

func NewRoleRepository(db *gorm.DB) domain.RoleRepository {
	return &roleRepository{
		BaseRepository: NewBaseRepository[domain.Role, uuid.UUID](db),
	}
}

func (r *roleRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Role, error) {
	var role domain.Role
	if err := r.DB(ctx).Preload("Permissions").First(&role, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

func (r *roleRepository) GetByCode(ctx context.Context, code string) (*domain.Role, error) {
	var role domain.Role
	if err := r.DB(ctx).Preload("Permissions").First(&role, "code = ?", code).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

const roleUserCountSelect = "roles.*, (SELECT COUNT(*) FROM sys_user_roles ur JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL WHERE ur.role_id = roles.id) AS user_count"

func (r *roleRepository) Search(ctx context.Context, keyword string, page, pageSize int) ([]domain.Role, int64, error) {
	var roles []domain.Role
	var total int64
	query := r.DB(ctx).Model(&domain.Role{})
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("roles.code LIKE ? OR roles.name LIKE ?", like, like)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if page > 0 && pageSize > 0 {
		query = query.Offset((page - 1) * pageSize).Limit(pageSize)
	}
	err := query.Select(roleUserCountSelect).Preload("Permissions").Order("roles.built_in DESC, roles.created_at ASC").Find(&roles).Error
	return roles, total, err
}

func (r *roleRepository) ListWithPermissions(ctx context.Context, codes []string) ([]domain.Role, error) {
	query := r.DB(ctx).Preload("Permissions")
	if codes != nil {
		if len(codes) == 0 {
			return []domain.Role{}, nil
		}
		query = query.Where("code IN ?", codes)
	}
	var roles []domain.Role
	err := query.Find(&roles).Error
	return roles, err
}

func (r *roleRepository) UpdateColumns(ctx context.Context, id uuid.UUID, values map[string]any) error {
	return r.DB(ctx).Model(&domain.Role{}).Where("id = ?", id).Updates(values).Error
}

func (r *roleRepository) ListAll(ctx context.Context) ([]domain.Role, error) {
	var roles []domain.Role
	err := r.DB(ctx).Order("built_in DESC, created_at ASC").Find(&roles).Error
	return roles, err
}

func (r *roleRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM sys_user_roles WHERE role_id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM sys_role_permissions WHERE role_id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&domain.Role{}, "id = ?", id).Error
	})
}

func (r *roleRepository) AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		var role domain.Role
		if err := tx.First(&role, "id = ?", roleID).Error; err != nil {
			return err
		}

		var perms []domain.Permission
		if len(permissionIDs) > 0 {
			if err := tx.Where("id IN ?", permissionIDs).Find(&perms).Error; err != nil {
				return err
			}
		}

		return tx.Model(&role).Association("Permissions").Replace(perms)
	})
}
