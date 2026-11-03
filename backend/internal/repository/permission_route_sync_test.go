package repository

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

func TestEnsureRoutePermissionConcurrentSyncIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "route-sync.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Permission{}, &domain.AuthorizationState{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.AuthorizationState{ID: domain.AuthorizationStateID, Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	repo := NewPermissionRepository(db)
	route := domain.RouteInfo{Method: "GET", Path: "/api/v1/reports/daily"}
	const workers = 8
	var wg sync.WaitGroup
	results := make(chan bool, workers)
	ids := make(chan uuid.UUID, workers)
	errs := make(chan error, workers)
	for range workers {
		wg.Go(func() {
			permission, created, err := repo.EnsureRoutePermission(context.Background(), route, domain.UnclassifiedAPIGroup)
			if err != nil {
				errs <- err
				return
			}
			results <- created
			ids <- permission.ID
		})
	}
	wg.Wait()
	close(results)
	close(ids)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	createdCount := 0
	var id uuid.UUID
	for created := range results {
		if created {
			createdCount++
		}
	}
	for got := range ids {
		if id == uuid.Nil {
			id = got
		} else if got != id {
			t.Fatalf("concurrent sync created multiple permission IDs: %s and %s", id, got)
		}
	}
	if createdCount != 1 {
		t.Fatalf("created count = %d, want 1", createdCount)
	}
	var count int64
	if err := db.Model(&domain.Permission{}).Where("code = ?", domain.APIPermissionCode(route.Method, route.Path)).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("route permission rows = %d, want 1", count)
	}
}
