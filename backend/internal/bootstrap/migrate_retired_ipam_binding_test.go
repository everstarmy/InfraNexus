package bootstrap

import (
	"testing"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
	"infranexus/internal/testdb"
)

func TestRetireIPAMBindingPreservesHistoryAndRemovesGrants(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable("ipam_rack_subnet_binding") || db.Migrator().HasTable("retired_ipam_rack_subnet_binding") {
		t.Fatal("fresh schema should have neither the former relation nor an archive")
	}

	// Restore the pre-upgrade state in the isolated test schema.
	if err := db.Unscoped().Where("version = ?", migrationRetiredIPAMBinding).Delete(&domain.SchemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"CREATE TABLE ipam_rack_subnet_binding (code text NOT NULL)",
		"INSERT INTO ipam_rack_subnet_binding (code) VALUES ('legacy')",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	role := domain.Role{Code: "legacy-operator", Name: "Legacy Operator", Status: domain.StatusEnabled}
	obsolete := domain.Permission{Code: "ipam:rack-bindings", Name: "Legacy", Type: domain.PermTypeMenu}
	if err := db.Create(&obsolete).Error; err != nil {
		t.Fatal(err)
	}
	custom := domain.Permission{ParentID: &obsolete.ID, Code: "ipam:custom", Name: "Custom", Type: domain.PermTypeButton}
	if err := db.Create(&custom).Error; err != nil {
		t.Fatal(err)
	}
	role.Permissions = []domain.Permission{obsolete, custom}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}

	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable("ipam_rack_subnet_binding") {
		t.Fatal("retired relation is still active")
	}
	var archived string
	if err := db.Table("retired_ipam_rack_subnet_binding").Select("code").Scan(&archived).Error; err != nil || archived != "legacy" {
		t.Fatalf("expected archived record, got %q: %v", archived, err)
	}
	var permissions []domain.Permission
	if err := db.Model(&role).Association("Permissions").Find(&permissions); err != nil {
		t.Fatal(err)
	}
	if len(permissions) != 1 || permissions[0].ID != custom.ID || permissions[0].ParentID != nil {
		t.Fatalf("expected only the unrelated permission grant to remain, got %+v", permissions)
	}
}
