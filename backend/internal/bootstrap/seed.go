package bootstrap

import (
	"errors"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"infranexus/internal/domain"
	"infranexus/internal/service"
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

// BootstrapAdmin creates the first local administrator exactly once. It never
// resets a password on an existing installation.
func BootstrapAdmin(db *gorm.DB, password string, log *slog.Logger) error {
	if password == "" {
		return fmt.Errorf("bootstrap password must be supplied explicitly")
	}
	if err := service.CheckPasswordStrength(password); err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		adminRole, err := ensureAdminRole(tx, log)
		if err != nil {
			return err
		}
		var existing domain.User
		err = tx.First(&existing, "domain = ? AND username = ?", "", "admin").Error
		if err == nil {
			if !existing.BuiltIn {
				return fmt.Errorf("username admin already exists and is not marked as a built-in account")
			}
			var count int64
			if err := tx.Table("sys_user_roles").Where("user_id = ? AND role_id = ?", existing.ID, adminRole.ID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return tx.Model(&existing).Association("Roles").Append(adminRole)
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("load bootstrap administrator: %w", err)
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		user := domain.User{
			Username: "admin", Email: "admin@infranexus.com", Password: string(hash),
			Nickname: "系统管理员", Status: domain.StatusEnabled, AuthType: domain.AuthTypeLocal, BuiltIn: true,
		}
		if err := tx.Create(&user).Error; err != nil {
			return fmt.Errorf("create bootstrap administrator: %w", err)
		}
		if err := tx.Model(&user).Association("Roles").Append(adminRole); err != nil {
			return fmt.Errorf("assign bootstrap administrator role: %w", err)
		}
		log.Info("Initialized bootstrap administrator", "username", user.Username)
		return nil
	})
}

// RotateBootstrapAdminPassword explicitly replaces the existing built-in
// local administrator credential and revokes every credential issued before it.
func RotateBootstrapAdminPassword(db *gorm.DB, password string) error {
	if password == "" {
		return fmt.Errorf("bootstrap password must be supplied explicitly")
	}
	if err := service.CheckPasswordStrength(password); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash administrator password: %w", err)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var user domain.User
		if err := tx.First(&user, "domain = ? AND username = ? AND built_in = ?", "", "admin", true).Error; err != nil {
			return fmt.Errorf("load built-in administrator: %w", err)
		}
		if user.AuthType != domain.AuthTypeLocal {
			return fmt.Errorf("built-in administrator must use local authentication")
		}
		result := tx.Model(&domain.User{}).Where("id = ?", user.ID).Updates(map[string]any{
			"password":            string(hash),
			"auth_version":        gorm.Expr("auth_version + 1"),
			"edit_revision":       gorm.Expr("edit_revision + 1"),
			"sessions_revoked_at": time.Now().UTC(),
		})
		if result.Error != nil {
			return fmt.Errorf("rotate built-in administrator password: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("built-in administrator was not updated")
		}
		return nil
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
