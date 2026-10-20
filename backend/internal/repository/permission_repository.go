package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

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
	var attach func(nodes []domain.Permission) []domain.Permission
	attach = func(nodes []domain.Permission) []domain.Permission {
		out := make([]domain.Permission, len(nodes))
		for i, node := range nodes {
			node.Children = attach(children[node.ID])
			out[i] = node
		}
		return out
	}
	return attach(roots)
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

func (r *permissionRepository) DeleteWithLinks(ctx context.Context, id uuid.UUID) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM sys_role_permissions WHERE permission_id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&domain.Permission{}, "id = ?", id).Error
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
