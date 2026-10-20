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

func TestIdentityIsScopedByDomainAndEmptyEmailsCoexist(t *testing.T) {
	container, _, cleanup := setupTestApp(t)
	defer cleanup()
	db := container.DB
	for _, table := range []any{&domain.Department{}, &domain.LDAPConfig{}, &domain.LDAPSyncLog{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table for %T", table)
		}
	}
	local := domain.User{Username: "zhangsan", Email: "", Password: "x"}
	corp := domain.User{Username: "zhangsan", Domain: "corp.local", AuthType: domain.AuthTypeAD, Email: ""}
	other := domain.User{Username: "zhangsan", Domain: "branch.local", AuthType: domain.AuthTypeAD, Email: ""}
	for _, u := range []*domain.User{&local, &corp, &other} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("create %s@%s: %v", u.Username, u.Domain, err)
		}
	}
	if local.AuthType != domain.AuthTypeLocal {
		t.Fatalf("local user auth type defaulted to %q", local.AuthType)
	}
	dup := domain.User{Username: "zhangsan", Domain: "corp.local", AuthType: domain.AuthTypeAD}
	if err := db.Create(&dup).Error; err == nil {
		t.Fatal("duplicate username accepted inside one domain")
	}
	if err := db.Create(&domain.User{Username: "lisi", Email: "dup@x.com"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.User{Username: "wangwu", Email: "dup@x.com"}).Error; err == nil {
		t.Fatal("duplicate non-empty email accepted")
	}
}
