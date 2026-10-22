package bootstrap

import (
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"infranexus/internal/domain"
)

const migrationSecurityRevisionState = "20261022_v01_security_and_revision_state"
const migrationLDAPSyncRequestID = "20261022_v02_ldap_sync_request_id"
const migrationAuthorizationOutboxRetry = "20261022_v03_authorization_outbox_retry"
const migrationLDAPRecoverableTasks = "20261022_v04_ldap_recoverable_tasks"

type migration struct {
	version string
	apply   func(*gorm.DB) error
}

type legacyIndex struct {
	model any
	name  string
}

var migrations = []migration{
	{version: migrationSecurityRevisionState, apply: migrateSecurityRevisionState},
	{version: migrationLDAPSyncRequestID, apply: migrateLDAPSyncRequestID},
	{version: migrationAuthorizationOutboxRetry, apply: migrateAuthorizationOutboxRetry},
	{version: migrationLDAPRecoverableTasks, apply: migrateLDAPRecoverableTasks},
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
		&domain.LDAPSyncPlanSnapshot{},
		&domain.OrganizationState{},
		&domain.AuthorizationState{},
		&domain.AuthorizationOutbox{},
	}
}

// Migrate applies each registered migration once. Each version row is written
// in the same transaction as its schema/data changes, so a failed migration is
// retried on the next startup instead of being reported as complete.
func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&domain.SchemaMigration{}); err != nil {
		return fmt.Errorf("initialize migration ledger: %w", err)
	}
	for _, current := range migrations {
		if err := applyMigration(db, current); err != nil {
			return fmt.Errorf("apply database migration %s: %w", current.version, err)
		}
	}
	return nil
}

func applyMigration(db *gorm.DB, current migration) error {
	return db.Transaction(func(tx *gorm.DB) error {
		ledgerEntry := domain.SchemaMigration{Version: current.version}
		result := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "version"}},
			DoNothing: true,
		}).Create(&ledgerEntry)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return current.apply(tx)
	})
}

func migrateSecurityRevisionState(tx *gorm.DB) error {
	migrator := tx.Migrator()
	for _, idx := range legacyIndexes {
		if migrator.HasTable(idx.model) && migrator.HasIndex(idx.model, idx.name) {
			if err := migrator.DropIndex(idx.model, idx.name); err != nil {
				return fmt.Errorf("drop legacy index %s: %w", idx.name, err)
			}
		}
	}
	if err := tx.AutoMigrate(models()...); err != nil {
		return fmt.Errorf("auto migrate application schema: %w", err)
	}
	if err := tx.Model(&domain.User{}).
		Where("auth_version < 1 OR auth_version IS NULL").
		Update("auth_version", 1).Error; err != nil {
		return fmt.Errorf("backfill user auth versions: %w", err)
	}
	if err := ensureRevisionRow(tx, "organization_state", "018f2a51-55b2-7f19-9000-000000000001"); err != nil {
		return fmt.Errorf("initialize organization revision: %w", err)
	}
	if err := ensureRevisionRow(tx, "authorization_state", "018f2a51-55b2-7f19-9000-000000000002"); err != nil {
		return fmt.Errorf("initialize authorization revision: %w", err)
	}
	return nil
}

func migrateLDAPSyncRequestID(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&domain.LDAPSyncLog{}); err != nil {
		return fmt.Errorf("add LDAP sync request correlation: %w", err)
	}
	return nil
}

func migrateAuthorizationOutboxRetry(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&domain.AuthorizationOutbox{}); err != nil {
		return fmt.Errorf("add authorization outbox retry state: %w", err)
	}
	return tx.Model(&domain.AuthorizationOutbox{}).
		Where("next_attempt_at IS NULL").
		Update("next_attempt_at", tx.NowFunc()).Error
}

func migrateLDAPRecoverableTasks(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&domain.LDAPConfig{}, &domain.LDAPSyncLog{}, &domain.LDAPSyncPlanSnapshot{}); err != nil {
		return fmt.Errorf("add LDAP plan and recoverable task state: %w", err)
	}
	return nil
}

func ensureRevisionRow(tx *gorm.DB, table, idText string) error {
	// Table names are fixed constants at call sites; the value remains parameterized.
	id := uuid.MustParse(idText)
	switch table {
	case "organization_state":
		row := domain.OrganizationState{ID: id, Revision: 1}
		return tx.Where("id = ?", id).Attrs(row).FirstOrCreate(&domain.OrganizationState{}).Error
	case "authorization_state":
		row := domain.AuthorizationState{ID: id, Revision: 1}
		return tx.Where("id = ?", id).Attrs(row).FirstOrCreate(&domain.AuthorizationState{}).Error
	default:
		return fmt.Errorf("unsupported revision state table %q", table)
	}
}
