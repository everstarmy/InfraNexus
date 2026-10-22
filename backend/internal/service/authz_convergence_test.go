package service_test

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/casbin/casbin/v3"
	"github.com/casbin/casbin/v3/model"
	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
	"infranexus/internal/middleware"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

func TestAuthorizationRevisionRefreshesIndependentInstancesAndRevokes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "authz.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Role{}, &domain.Permission{}, &domain.AuthorizationState{}, &domain.AuthorizationOutbox{}); err != nil {
		t.Fatal(err)
	}
	state := domain.AuthorizationState{ID: domain.AuthorizationStateID, Revision: 1}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}
	adapter, err := gormadapter.NewAdapterByDB(db)
	if err != nil {
		t.Fatal(err)
	}
	newEnforcer := func() *casbin.SyncedEnforcer {
		t.Helper()
		policyModel, err := model.NewModelFromString(middleware.RBACModel)
		if err != nil {
			t.Fatal(err)
		}
		enforcer, err := casbin.NewSyncedEnforcer(policyModel, adapter)
		if err != nil {
			t.Fatal(err)
		}
		enforcer.EnableAutoSave(false)
		if err := enforcer.LoadPolicy(); err != nil {
			t.Fatal(err)
		}
		return enforcer
	}

	roles := repository.NewRoleRepository(db)
	permissions := repository.NewPermissionRepository(db)
	stateRepo := repository.NewAuthorizationStateRepository(db)
	instanceA := service.NewAuthorizationService(newEnforcer(), roles, permissions, stateRepo, nil, nil)
	instanceB := service.NewAuthorizationService(newEnforcer(), roles, permissions, stateRepo, nil, nil)

	role := domain.Role{Code: "operator", Name: "Operator", Status: domain.StatusEnabled}
	if err := roles.Create(ctx, &role); err != nil {
		t.Fatal(err)
	}
	permission := domain.Permission{
		Code: "api:GET:/api/v1/users", Name: "List users", Type: domain.PermTypeAPI,
		Path: "/api/v1/users", Method: "GET",
	}
	if err := permissions.Create(ctx, &permission); err != nil {
		t.Fatal(err)
	}
	if err := roles.AssignPermissions(ctx, role.ID, []uuid.UUID{permission.ID}, 1); err != nil {
		t.Fatal(err)
	}

	concurrentInstance := service.NewAuthorizationService(newEnforcer(), roles, permissions, stateRepo, nil, nil)
	const concurrentReaders = 32
	startRefresh := make(chan struct{})
	refreshResults := make(chan error, concurrentReaders)
	var refreshWait sync.WaitGroup
	for range concurrentReaders {
		refreshWait.Add(1)
		go func() {
			defer refreshWait.Done()
			<-startRefresh
			allowed, err := concurrentInstance.Enforce(ctx, role.Code, permission.Path, permission.Method)
			if err != nil {
				refreshResults <- err
			} else if !allowed {
				refreshResults <- errors.New("policy was denied during concurrent initial refresh")
			}
		}()
	}
	close(startRefresh)
	refreshWait.Wait()
	close(refreshResults)
	for err := range refreshResults {
		if err != nil {
			t.Fatal(err)
		}
	}

	for name, instance := range map[string]domain.AuthorizationService{"A": instanceA, "B": instanceB} {
		t.Run("grant visible on instance "+name, func(t *testing.T) {
			allowed, err := instance.Enforce(ctx, role.Code, permission.Path, permission.Method)
			if err != nil || !allowed {
				t.Fatalf("Enforce() = (%v, %v), want allowed", allowed, err)
			}
		})
	}

	if err := roles.UpdateStatus(ctx, role.ID, domain.StatusDisabled, 2); err != nil {
		t.Fatal(err)
	}
	for name, instance := range map[string]domain.AuthorizationService{"A": instanceA, "B": instanceB} {
		t.Run("revocation visible on instance "+name, func(t *testing.T) {
			allowed, err := instance.Enforce(ctx, role.Code, permission.Path, permission.Method)
			if err != nil || allowed {
				t.Fatalf("Enforce() = (%v, %v), want denied", allowed, err)
			}
		})
	}

	var current domain.AuthorizationState
	if err := db.First(&current, "id = ?", domain.AuthorizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if current.Revision != 3 {
		t.Fatalf("authorization revision = %d, want grant and revocation revisions 3", current.Revision)
	}
	var pending int64
	if err := db.Model(&domain.AuthorizationOutbox{}).Where("processed_at IS NULL").Count(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if pending != 2 {
		t.Fatalf("pending outbox rows = %d, want 2", pending)
	}
	rows, err := stateRepo.Pending(ctx, time.Now().Add(time.Second), 10)
	if err != nil || len(rows) != 2 {
		t.Fatalf("Pending() = %d rows, %v; want 2 rows", len(rows), err)
	}
}
