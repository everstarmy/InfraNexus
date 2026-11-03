package bootstrap

import (
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"infranexus/internal/domain"
	"infranexus/internal/service"
)

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
