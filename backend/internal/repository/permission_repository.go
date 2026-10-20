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

	// 内存中构建树形结构
	permMap := make(map[uuid.UUID]*domain.Permission)
	var rootPerms []domain.Permission

	for i := range allPerms {
		p := allPerms[i]
		p.Children = make([]domain.Permission, 0)
		permMap[p.ID] = &p
	}

	for _, p := range permMap {
		if p.ParentID == nil || *p.ParentID == uuid.Nil {
			rootPerms = append(rootPerms, *p)
		} else {
			if parent, exists := permMap[*p.ParentID]; exists {
				parent.Children = append(parent.Children, *p)
			} else {
				rootPerms = append(rootPerms, *p)
			}
		}
	}

	return rootPerms, nil
}

func (r *permissionRepository) GetByRoleID(ctx context.Context, roleID uuid.UUID) ([]domain.Permission, error) {
	var role domain.Role
	if err := r.DB(ctx).Preload("Permissions").First(&role, "id = ?", roleID).Error; err != nil {
		return nil, err
	}
	return role.Permissions, nil
}
