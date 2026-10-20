package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

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

func (r *userRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	var user domain.User
	if err := r.DB(ctx).Preload("Roles").First(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByUsername(ctx context.Context, username string) (*domain.User, error) {
	var user domain.User
	if err := r.DB(ctx).Preload("Roles").First(&user, "username = ?", username).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	var user domain.User
	if err := r.DB(ctx).Preload("Roles").First(&user, "email = ?", email).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) List(ctx context.Context, page, pageSize int, filters map[string]any) ([]domain.User, int64, error) {
	var users []domain.User
	var total int64

	query := r.DB(ctx).Model(&domain.User{}).Preload("Roles")

	if kw, ok := filters["keyword"].(string); ok && kw != "" {
		likePattern := "%" + kw + "%"
		query = query.Where("username LIKE ? OR email LIKE ? OR nickname LIKE ?", likePattern, likePattern, likePattern)
	}

	if st, ok := filters["status"].(int); ok && st != 0 {
		query = query.Where("status = ?", st)
	}

	if roleID, ok := filters["role_id"].(uuid.UUID); ok && roleID != uuid.Nil {
		query = query.Joins("JOIN sys_user_roles ON sys_user_roles.user_id = sys_users.id AND sys_user_roles.role_id = ?", roleID)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if page > 0 && pageSize > 0 {
		offset := (page - 1) * pageSize
		query = query.Offset(offset).Limit(pageSize)
	}

	if err := query.Order("created_at DESC").Find(&users).Error; err != nil {
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
		}

		return tx.Model(&user).Association("Roles").Replace(roles)
	})
}
