package repository

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

func TestDeleteConfigRefusesActiveSyncLease(t *testing.T) {
	testDeleteConfigLease(t, sqlite.Open(":memory:"))
}

func TestDeleteConfigRefusesActiveSyncLeasePostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	testDeleteConfigLease(t, postgres.Open(dsn))
}

func testDeleteConfigLease(t *testing.T, driver gorm.Dialector) {
	t.Helper()
	db, err := gorm.Open(driver, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.LDAPConfig{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	create := func(status string, lease *time.Time) domain.LDAPConfig {
		suffix := uuid.NewString()[:8]
		cfg := domain.LDAPConfig{Name: "lease-" + suffix, Type: "ldap", Domain: "lease-" + suffix + ".test", ServerHost: "127.0.0.1", Port: 389, BaseDN: "dc=test", SyncStatus: status, SyncLeaseExpiresAt: lease}
		if err := db.Create(&cfg).Error; err != nil {
			t.Fatal(err)
		}
		return cfg
	}
	repo := NewLDAPRepository(db)
	future, past := now.Add(time.Minute), now.Add(-time.Minute)

	running := create(domain.SyncStatusRunning, &future)
	if err := repo.DeleteConfig(t.Context(), running.ID, now); !errors.Is(err, domain.ErrDirectorySyncActive) {
		t.Fatalf("active lease deletion error = %v", err)
	}
	if _, err := repo.GetConfig(t.Context(), running.ID); err != nil {
		t.Fatalf("running config must remain: %v", err)
	}
	for _, cfg := range []domain.LDAPConfig{create(domain.SyncStatusRunning, &past), create(domain.SyncStatusIdle, nil)} {
		if err := repo.DeleteConfig(t.Context(), cfg.ID, now); err != nil {
			t.Fatalf("stale or idle config %s was not deleted: %v", cfg.SyncStatus, err)
		}
		if _, err := repo.GetConfig(t.Context(), cfg.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("deleted config is still visible: %v", err)
		}
	}
	if err := repo.DeleteConfig(t.Context(), uuid.New(), now); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing config error = %v", err)
	}
}
