package bootstrap

import (
	"fmt"

	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type legacyIndex struct {
	model any
	name  string
}

var legacyIndexes = []legacyIndex{
	{&domain.User{}, "idx_users_username"},
	{&domain.User{}, "idx_users_email"},
	{&domain.Role{}, "idx_roles_code"},
	{&domain.Permission{}, "idx_permissions_code"},
	{&domain.User{}, "uidx_users_username"},
	{&domain.User{}, "uidx_users_email"},
}

func models() []any {
	return []any{
		&domain.Department{},
		&domain.User{},
		&domain.Role{},
		&domain.Permission{},
		&domain.LDAPConfig{},
		&domain.LDAPSyncLog{},
	}
}

func Migrate(db *gorm.DB) error {
	migrator := db.Migrator()
	for _, idx := range legacyIndexes {
		if migrator.HasTable(idx.model) && migrator.HasIndex(idx.model, idx.name) {
			if err := migrator.DropIndex(idx.model, idx.name); err != nil {
				return fmt.Errorf("drop legacy index %s: %w", idx.name, err)
			}
		}
	}
	if err := db.AutoMigrate(models()...); err != nil {
		return fmt.Errorf("auto migration failed: %w", err)
	}
	return nil
}
