package repository

import (
	"errors"
	"sync"
	"testing"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
	"infranexus/internal/testdb"
)

func TestSetupConcurrentInitializationPostgres(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	runSetupConcurrency(t, db)
}

func runSetupConcurrency(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	role := domain.Role{Code: domain.AdminRoleCode, Name: "Administrator", BuiltIn: true, Status: domain.StatusEnabled}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	const workers = 8
	start := make(chan struct{})
	results := make(chan error, workers)
	var group sync.WaitGroup
	for range workers {
		group.Go(func() {
			<-start
			// Separate repository instances model separate HTTP service processes.
			repo := NewSetupRepository(db)
			user := &domain.User{Username: "admin", Password: "hashed-password", BuiltIn: true, Status: domain.StatusEnabled, AuthType: domain.AuthTypeLocal}
			results <- repo.Initialize(t.Context(), user)
		})
	}
	close(start)
	group.Wait()
	close(results)
	var succeeded, rejected int
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, domain.ErrAlreadyInitialized):
			rejected++
		default:
			t.Fatalf("unexpected concurrent initialization error: %v", err)
		}
	}
	if succeeded != 1 || rejected != workers-1 {
		t.Fatalf("initialization results: success=%d rejected=%d", succeeded, rejected)
	}
	var count int64
	if err := db.Model(&domain.User{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("administrator count=%d, error=%v", count, err)
	}
	var user domain.User
	if err := db.Preload("Roles").First(&user).Error; err != nil || len(user.Roles) != 1 || user.Roles[0].ID != role.ID {
		t.Fatal("administrator and role were not committed together")
	}
	if err := db.Delete(&user).Error; err != nil {
		t.Fatal(err)
	}
	if initialized, err := NewSetupRepository(db).Initialized(t.Context()); err != nil || !initialized {
		t.Fatal("setup reopened after soft deletion")
	}
}

func TestSetupRoleAssignmentFailureRollsBackAdministrator(t *testing.T) {
	db := openOrganizationPostgres(t)
	if err := db.AutoMigrate(&domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	role := domain.Role{Code: domain.AdminRoleCode, Name: "Administrator", BuiltIn: true, Status: domain.StatusEnabled}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ALTER TABLE sys_user_roles ADD CONSTRAINT reject_setup_role CHECK (false)").Error; err != nil {
		t.Fatal(err)
	}
	repo := NewSetupRepository(db)
	user := &domain.User{Username: "admin", Password: "hashed-password", BuiltIn: true, AuthType: domain.AuthTypeLocal}
	if err := repo.Initialize(t.Context(), user); err == nil {
		t.Fatal("initialization accepted failed role assignment")
	}
	if initialized, err := repo.Initialized(t.Context()); err != nil || initialized {
		t.Fatal("failed role assignment left a partially initialized administrator")
	}
	if err := db.Exec("ALTER TABLE sys_user_roles DROP CONSTRAINT reject_setup_role").Error; err != nil {
		t.Fatal(err)
	}
	user = &domain.User{Username: "admin", Password: "hashed-password", BuiltIn: true, AuthType: domain.AuthTypeLocal}
	if err := repo.Initialize(t.Context(), user); err != nil {
		t.Fatalf("initialization could not retry after rollback: %v", err)
	}
}
