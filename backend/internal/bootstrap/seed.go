package bootstrap

import (
	"errors"
	"fmt"
	"log/slog"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

func Seed(db *gorm.DB, log *slog.Logger) error {
	return db.Transaction(func(tx *gorm.DB) error {
		adminRole, err := ensureAdminRole(tx, log)
		if err != nil {
			return err
		}
		if err := ensureAdminUser(tx, log, adminRole); err != nil {
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

func ensureAdminUser(tx *gorm.DB, log *slog.Logger, adminRole *domain.Role) error {
	var user domain.User
	err := tx.First(&user, "domain = ? AND username = ?", "", "admin").Error
	if err == nil {
		if user.BuiltIn {
			return nil
		}
		return tx.Model(&user).Update("built_in", true).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("load admin user: %w", err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("admin123456"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	user = domain.User{
		Username: "admin",
		Email:    "admin@infranexus.com",
		Password: string(hash),
		Nickname: "系统管理员",
		Status:   domain.StatusEnabled,
		AuthType: domain.AuthTypeLocal,
		BuiltIn:  true,
	}
	if err := tx.Create(&user).Error; err != nil {
		return fmt.Errorf("seed admin user: %w", err)
	}
	if err := tx.Model(&user).Association("Roles").Replace([]domain.Role{*adminRole}); err != nil {
		return fmt.Errorf("assign admin role: %w", err)
	}
	log.Info("Seeded default admin user (admin / admin123456)")
	return nil
}
