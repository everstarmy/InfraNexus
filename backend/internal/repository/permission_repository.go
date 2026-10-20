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
