package repository

import (
	"testing"
	"time"

	"gorm.io/gorm"
	"infranexus/internal/domain"
	"infranexus/internal/testdb"
)

func TestExpiredPlansArePhysicallyDeletedPostgres(t *testing.T) {
	testExpiredPlans(t, testdb.Dialector(t))
}

func testExpiredPlans(t *testing.T, driver gorm.Dialector) {
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
	if err := db.AutoMigrate(&domain.LDAPSyncPlanSnapshot{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	// This suite only runs against an explicitly disposable test database.
	if err := db.Unscoped().Where("1 = 1").Delete(&domain.LDAPSyncPlanSnapshot{}).Error; err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		expiry := now.Add(-time.Hour)
		if i == 2 {
			expiry = now.Add(time.Hour)
		}
		plan := domain.LDAPSyncPlanSnapshot{ExpiresAt: expiry}
		if err := db.Create(&plan).Error; err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if err := db.Delete(&plan).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	n, err := NewLDAPRepository(db).DeleteExpiredPlans(t.Context(), now)
	if err != nil || n != 2 {
		t.Fatalf("deleted=%d err=%v", n, err)
	}
	var retained int64
	if err := db.Unscoped().Model(&domain.LDAPSyncPlanSnapshot{}).Count(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained != 1 {
		t.Fatalf("retained=%d, want future plan only", retained)
	}
}
