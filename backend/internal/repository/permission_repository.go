package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"infranexus/internal/domain"
)

type permissionRepository struct {
	*BaseRepository[domain.Permission, uuid.UUID]
}

func NewPermissionRepository(db *gorm.DB) domain.PermissionRepository {
	return &permissionRepository{
		BaseRepository: NewBaseRepository[domain.Permission, uuid.UUID](db),
	}
}

func (r *permissionRepository) GetTree(ctx context.Context) ([]domain.Permission, error) {
	var allPerms []domain.Permission
	if err := r.DB(ctx).Order("sort_order ASC, created_at ASC").Find(&allPerms).Error; err != nil {
		return nil, err
	}
	return BuildPermissionTree(allPerms), nil
}

func BuildPermissionTree(ordered []domain.Permission) []domain.Permission {
	known := make(map[uuid.UUID]bool, len(ordered))
	for _, p := range ordered {
		known[p.ID] = true
	}
	children := make(map[uuid.UUID][]domain.Permission)
	roots := make([]domain.Permission, 0)
	for _, p := range ordered {
		if p.ParentID == nil || *p.ParentID == uuid.Nil || !known[*p.ParentID] {
			roots = append(roots, p)
			continue
		}
		children[*p.ParentID] = append(children[*p.ParentID], p)
	}
	visited := make(map[uuid.UUID]bool, len(ordered))
	var attach func(nodes []domain.Permission) []domain.Permission
	attach = func(nodes []domain.Permission) []domain.Permission {
		out := make([]domain.Permission, 0, len(nodes))
		for _, node := range nodes {
			if visited[node.ID] {
				continue
			}
			visited[node.ID] = true
			node.Children = attach(children[node.ID])
			out = append(out, node)
		}
		return out
	}
	tree := attach(roots)
	// Concurrent re-parenting can leave a parent cycle that no root reaches.
	// Surface those nodes as roots instead of silently dropping them.
	for _, p := range ordered {
		if !visited[p.ID] {
			p.ParentID = nil
			tree = append(tree, attach([]domain.Permission{p})...)
		}
	}
	return tree
}

func (r *permissionRepository) GetByRoleID(ctx context.Context, roleID uuid.UUID) ([]domain.Permission, error) {
	var role domain.Role
	if err := r.DB(ctx).Preload("Permissions").First(&role, "id = ?", roleID).Error; err != nil {
		return nil, err
	}
	return role.Permissions, nil
}

func (r *permissionRepository) ListAll(ctx context.Context) ([]domain.Permission, error) {
	var perms []domain.Permission
	err := r.DB(ctx).Order("sort_order ASC, created_at ASC").Find(&perms).Error
	return perms, err
}

func (r *permissionRepository) GetByCode(ctx context.Context, code string) (*domain.Permission, error) {
	var perm domain.Permission
	if err := r.DB(ctx).First(&perm, "code = ?", code).Error; err != nil {
		return nil, err
	}
	return &perm, nil
}

func (r *permissionRepository) CountChildren(ctx context.Context, id uuid.UUID) (int64, error) {
	var count int64
	err := r.DB(ctx).Model(&domain.Permission{}).Where("parent_id = ?", id).Count(&count).Error
	return count, err
}

func (r *permissionRepository) RoleIDsByPermission(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.DB(ctx).Table("sys_role_permissions").Where("permission_id = ?", id).Pluck("role_id", &ids).Error
	return ids, err
}

func (r *permissionRepository) EnsureRoutePermission(ctx context.Context, route domain.RouteInfo, parentCode string) (*domain.Permission, bool, error) {
	var permission domain.Permission
	created := false
	err := withAuthorizationWrite(ctx, r.DB(ctx), func(tx *gorm.DB) error {
		// The transaction may be retried after a commit conflict. Reset values
		// captured for the caller so a previous attempt cannot leak into this one.
		permission = domain.Permission{}
		created = false

		// Serializing catalog writes on the shared state row makes concurrent sync
		// calls converge before they decide whether a route permission is missing.

		code := domain.APIPermissionCode(route.Method, route.Path)
		if err := tx.First(&permission, "code = ?", code).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		var parent domain.Permission
		if parentCode != "" {
			if err := tx.First(&parent, "code = ? AND type = ?", parentCode, domain.PermTypeMenu).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		if parent.ID == uuid.Nil {
			if err := tx.First(&parent, "code = ?", domain.UnclassifiedAPIGroup).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				parent = domain.Permission{Code: domain.UnclassifiedAPIGroup, Name: "未归类接口", Type: domain.PermTypeMenu, Icon: "Unplug", SortOrder: 999}
				if err := tx.Clauses(clause.OnConflict{
					Columns:     []clause.Column{{Name: "code"}},
					TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "deleted_at IS NULL"}}},
					DoNothing:   true,
				}).Create(&parent).Error; err != nil {
					return err
				}
				if err := tx.First(&parent, "code = ?", domain.UnclassifiedAPIGroup).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
		}

		permission = domain.Permission{
			ParentID: &parent.ID,
			Code:     code,
			Name:     route.Method + " " + route.Path,
			Type:     domain.PermTypeAPI,
			Path:     route.Path,
			Method:   route.Method,
			BuiltIn:  true,
		}
		result := tx.Clauses(clause.OnConflict{
			Columns:     []clause.Column{{Name: "code"}},
			TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "deleted_at IS NULL"}}},
			DoNothing:   true,
		}).Create(&permission)
		if result.Error != nil {
			return result.Error
		}
		created = result.RowsAffected == 1
		if !created {
			return tx.First(&permission, "code = ?", code).Error
		}
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &permission, created, nil
}

func (r *permissionRepository) DeleteWithLinks(ctx context.Context, id uuid.UUID) error {
	return withAuthorizationWrite(ctx, r.DB(ctx), func(tx *gorm.DB) error {
		var roleIDs []uuid.UUID
		if err := tx.Table("sys_role_permissions").Where("permission_id = ?", id).Order("role_id ASC").Pluck("role_id", &roleIDs).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM sys_role_permissions WHERE permission_id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Delete(&domain.Permission{}, "id = ?", id).Error; err != nil {
			return err
		}
		changed := false
		for _, roleID := range roleIDs {
			var role domain.Role
			if err := tx.Preload("Permissions").First(&role, "id = ?", roleID).Error; err != nil {
				return err
			}
			roleChanged, err := replaceRolePolicy(tx, role)
			if err != nil {
				return err
			}
			changed = changed || roleChanged
		}
		if changed {
			return appendAuthorizationOutbox(tx, policyEvent("permission.deleted"))
		}
		return nil
	})
}

func (r *permissionRepository) UpdateWithAuthorization(ctx context.Context, permission *domain.Permission) error {
	return withAuthorizationWrite(ctx, r.DB(ctx), func(tx *gorm.DB) error {
		var roleIDs []uuid.UUID
		if err := tx.Table("sys_role_permissions").Where("permission_id = ?", permission.ID).Order("role_id ASC").Pluck("role_id", &roleIDs).Error; err != nil {
			return err
		}
		if err := tx.Save(permission).Error; err != nil {
			return err
		}
		changed := false
		for _, roleID := range roleIDs {
			var role domain.Role
			if err := tx.Preload("Permissions").First(&role, "id = ?", roleID).Error; err != nil {
				return err
			}
			roleChanged, err := replaceRolePolicy(tx, role)
			if err != nil {
				return err
			}
			changed = changed || roleChanged
		}
		if changed {
			return appendAuthorizationOutbox(tx, policyEvent("permission.updated"))
		}
		return nil
	})
}

func (r *permissionRepository) CountByType(ctx context.Context) (map[domain.PermissionType]int64, error) {
	var rows []struct {
		Type  domain.PermissionType
		Count int64
	}
	if err := r.DB(ctx).Model(&domain.Permission{}).Select("type, COUNT(*) AS count").Group("type").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[domain.PermissionType]int64, len(rows))
	for _, row := range rows {
		counts[row.Type] = row.Count
	}
	return counts, nil
}
