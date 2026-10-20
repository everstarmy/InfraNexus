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

func (r *userRepository) Search(ctx context.Context, f domain.UserFilter) ([]domain.User, int64, error) {
	var users []domain.User
	var total int64

	query := r.DB(ctx).Model(&domain.User{})

	if f.Keyword != "" {
		likePattern := "%" + f.Keyword + "%"
		query = query.Where("users.username LIKE ? OR users.email LIKE ? OR users.nickname LIKE ?", likePattern, likePattern, likePattern)
	}

	if f.Status != nil && *f.Status != 0 {
		query = query.Where("users.status = ?", *f.Status)
	}

	if f.RoleID != nil && *f.RoleID != uuid.Nil {
		query = query.Where("EXISTS (SELECT 1 FROM sys_user_roles ur WHERE ur.user_id = users.id AND ur.role_id = ?)", *f.RoleID)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if f.Page > 0 && f.PageSize > 0 {
		query = query.Offset((f.Page - 1) * f.PageSize).Limit(f.PageSize)
	}

	if err := query.Preload("Roles").Order("users.created_at DESC").Find(&users).Error; err != nil {
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
