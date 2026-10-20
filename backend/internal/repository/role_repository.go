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

func (r *roleRepository) List(ctx context.Context, page, pageSize int, filters map[string]any) ([]domain.Role, int64, error) {
	var roles []domain.Role
	var total int64

	query := r.DB(ctx).Model(&domain.Role{}).Preload("Permissions")

	if kw, ok := filters["keyword"].(string); ok && kw != "" {
		likePattern := "%" + kw + "%"
		query = query.Where("code LIKE ? OR name LIKE ?", likePattern, likePattern)
	}

	if st, ok := filters["status"].(int); ok && st != 0 {
		query = query.Where("status = ?", st)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if page > 0 && pageSize > 0 {
		offset := (page - 1) * pageSize
		query = query.Offset(offset).Limit(pageSize)
	}

	if err := query.Order("created_at DESC").Find(&roles).Error; err != nil {
		return nil, 0, err
	}

	return roles, total, nil
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
