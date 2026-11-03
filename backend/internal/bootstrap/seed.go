package bootstrap

import (
	"errors"
	"fmt"
	"log/slog"

	"gorm.io/gorm"

	"infranexus/internal/domain"
)

func Seed(db *gorm.DB, log *slog.Logger) error {
	return db.Transaction(func(tx *gorm.DB) error {
		_, err := ensureAdminRole(tx, log)
		if err != nil {
			return err
		}
		return seedPermissions(tx)
	})
}

func ensureAdminRole(tx *gorm.DB, log *slog.Logger) (*domain.Role, error) {
	var role domain.Role
	err := tx.First(&role, "code = ?", domain.AdminRoleCode).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		role = domain.Role{
			Code:        domain.AdminRoleCode,
			Name:        "超级管理员",
			Description: "拥有平台所有最高管理权限",
			Status:      domain.StatusEnabled,
			BuiltIn:     true,
		}
		if err := tx.Create(&role).Error; err != nil {
			return nil, fmt.Errorf("seed admin role: %w", err)
		}
		log.Info("Seeded default admin role")
		return &role, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load admin role: %w", err)
	}
	if !role.BuiltIn {
		if err := tx.Model(&role).Update("built_in", true).Error; err != nil {
			return nil, fmt.Errorf("mark admin role built-in: %w", err)
		}
	}
	return &role, nil
}
