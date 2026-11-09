package repository

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type setupRepository struct{ db *gorm.DB }

func NewSetupRepository(db *gorm.DB) domain.SetupRepository {
	return &setupRepository{db: db}
}

func administratorExists(db *gorm.DB) (bool, error) {
	var count int64
	// Include disabled and soft-deleted accounts: setup must never become a
	// password-reset path after an administrator has been created.
	err := db.Unscoped().Model(&domain.User{}).
		Where("domain = ? AND username = ?", "", "admin").Count(&count).Error
	return count > 0, err
}

func (r *setupRepository) Initialized(ctx context.Context) (bool, error) {
	return administratorExists(r.db.WithContext(ctx))
}

// lockAdministratorInitialization serializes HTTP initialization across
// processes. A no-op write locks the seeded role before reading users.
func lockAdministratorInitialization(tx *gorm.DB) error {
	result := tx.Model(&domain.Role{}).Where("code = ?", domain.AdminRoleCode).
		UpdateColumn("built_in", gorm.Expr("built_in"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("administrator role is not seeded")
	}
	return nil
}

func (r *setupRepository) Initialize(ctx context.Context, user *domain.User) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAdministratorInitialization(tx); err != nil {
			return fmt.Errorf("lock administrator initialization: %w", err)
		}
		initialized, err := administratorExists(tx)
		if err != nil {
			return fmt.Errorf("check administrator initialization: %w", err)
		}
		if initialized {
			return domain.ErrAlreadyInitialized
		}
		var role domain.Role
		if err := tx.First(&role, "code = ?", domain.AdminRoleCode).Error; err != nil {
			return fmt.Errorf("load administrator role: %w", err)
		}
		if err := tx.Create(user).Error; err != nil {
			return fmt.Errorf("create administrator: %w", err)
		}
		if err := tx.Model(user).Association("Roles").Append(&role); err != nil {
			return fmt.Errorf("assign administrator role: %w", err)
		}
		return nil
	})
}
