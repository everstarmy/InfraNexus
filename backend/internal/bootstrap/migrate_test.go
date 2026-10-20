package bootstrap

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

type legacyUser struct {
	domain.BaseEntity
	Username string `gorm:"size:64;uniqueIndex;not null"`
	Email    string `gorm:"size:128;uniqueIndex;not null"`
	Password string `gorm:"size:255;not null"`
}

func (legacyUser) TableName() string { return "users" }

type legacyRole struct {
	domain.BaseEntity
	Code string `gorm:"size:64;uniqueIndex;not null"`
	Name string `gorm:"size:64;not null"`
}

func (legacyRole) TableName() string { return "roles" }

func TestMigrateUpgradesLegacyUniqueIndexesSoDeletedNamesCanBeReused(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "legacy.db")), &gorm.Config{Logger: logger.Discard, TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&legacyUser{}, &legacyRole{}); err != nil {
		t.Fatal(err)
	}
	old := legacyUser{Username: "alice", Email: "alice@x.com", Password: "x"}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&old).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyUser{Username: "alice", Email: "alice@x.com", Password: "x"}).Error; err == nil {
		t.Fatal("legacy schema unexpectedly allowed reuse; test precondition broken")
	}
	for range 2 {
		if err := Migrate(db); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}
	for _, name := range []string{"idx_users_username", "idx_users_email", "idx_roles_code"} {
		if db.Migrator().HasIndex(&domain.User{}, name) || db.Migrator().HasIndex(&domain.Role{}, name) {
			t.Fatalf("legacy index %s still present", name)
		}
	}
	if err := db.Create(&domain.User{Username: "alice", Email: "alice@x.com", Password: "x"}).Error; err != nil {
		t.Fatalf("reuse after migrate: %v", err)
	}
	if err := db.Create(&domain.User{Username: "alice", Email: "other@x.com", Password: "x"}).Error; err == nil {
		t.Fatal("active duplicate username accepted after migrate")
	}
}
