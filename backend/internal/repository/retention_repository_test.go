package repository

import (
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infranexus/internal/domain"
)

func TestRetentionSQLite(t *testing.T) { testRetention(t, sqlite.Open(":memory:")) }
func TestRetentionPostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	testRetention(t, postgres.Open(dsn))
}
func testRetention(t *testing.T, driver gorm.Dialector) {
	db, err := gorm.Open(driver, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.AuthorizationOutbox{}, &domain.LDAPSyncLog{}, &domain.LDAPConfig{}); err != nil {
		t.Fatal(err)
	}
	for _, model := range []any{&domain.AuthorizationOutbox{}, &domain.LDAPSyncLog{}, &domain.LDAPConfig{}} {
		if err := db.Unscoped().Where("1 = 1").Delete(model).Error; err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().AddDate(0, 0, -100)
	now := time.Now()
	for i := range 4 {
		row := domain.AuthorizationOutbox{Revision: int64(i + 1)}
		if i < 2 {
			row.ProcessedAt = &old
		}
		if i == 2 {
			row.ProcessedAt = &now
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	operator := uuid.New()
	configID := uuid.New()
	var recentID uuid.UUID
	for i, status := range []string{"success", "failed", "partial", "running", "success", "success"} {
		row := domain.LDAPSyncLog{ConfigID: configID, OperatorID: &operator, Status: status, FinishedAt: &old, IdempotencyKey: string(rune('a' + i))}
		if i == 4 {
			row.FinishedAt = &now
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if i == 4 {
			recentID = row.ID
		}
		if i == 5 {
			cfg := domain.LDAPConfig{BaseEntity: domain.BaseEntity{ID: configID}, Domain: "retention.example.test", SyncTaskID: &row.ID, SyncStatus: domain.SyncStatusRunning}
			if err := db.Create(&cfg).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	repo := NewRetentionRepository(db)
	cutoff := now.AddDate(0, 0, -90)
	n, err := repo.Cleanup(t.Context(), cutoff, cutoff, 1)
	if err != nil || n != 2 {
		t.Fatalf("bounded batch=%d err=%v", n, err)
	}
	n, err = repo.Cleanup(t.Context(), cutoff, cutoff, 100)
	if err != nil || n != 3 {
		t.Fatalf("remaining expired=%d err=%v", n, err)
	}
	recent, err := NewLDAPRepository(db).GetLogByIdempotency(t.Context(), configID, operator, "e")
	if err != nil || recent.ID != recentID {
		t.Fatalf("retained idempotency response missing: %v", err)
	}
	var outbox, logs int64
	db.Unscoped().Model(&domain.AuthorizationOutbox{}).Count(&outbox)
	db.Unscoped().Model(&domain.LDAPSyncLog{}).Count(&logs)
	if outbox != 2 || logs != 3 {
		t.Fatalf("preserved pending/recent/running: outbox=%d logs=%d", outbox, logs)
	}
}
