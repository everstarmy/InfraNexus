package repository

import (
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

func TestSetupConcurrentInitialization(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "setup.db")+"?_busy_timeout=5000"), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	runSetupConcurrency(t, db)
}

func TestSetupConcurrentInitializationPostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	connection, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("parse isolated PostgreSQL connection configuration")
	}
	control, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal("connect isolated PostgreSQL database")
	}
	controlSQL, err := control.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = controlSQL.Close() })

	// Other repository tests use the shared database. Keep this first-run
	// scenario in its own schema instead of assuming the public users table is empty.
	schema := "setup_test_" + strings.ToLower(rand.Text())
	if err := control.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := control.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Errorf("drop setup test schema: %v", err)
		}
	})
	// A session-level SET would affect only one pooled connection. RuntimeParams
	// applies this search path to every connection used by the concurrent workers.
	if connection.RuntimeParams == nil {
		connection.RuntimeParams = make(map[string]string)
	}
	connection.RuntimeParams["search_path"] = schema
	sqlDB := stdlib.OpenDB(*connection)
	sqlDB.SetMaxOpenConns(8)
	t.Cleanup(func() { _ = sqlDB.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal("open isolated setup test schema")
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
	db := openOrganizationSQLite(t, "setup-rollback.db")
	if err := db.AutoMigrate(&domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	role := domain.Role{Code: domain.AdminRoleCode, Name: "Administrator", BuiltIn: true, Status: domain.StatusEnabled}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TRIGGER reject_setup_role BEFORE INSERT ON sys_user_roles BEGIN SELECT RAISE(ABORT, 'role assignment rejected'); END").Error; err != nil {
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
	if err := db.Exec("DROP TRIGGER reject_setup_role").Error; err != nil {
		t.Fatal(err)
	}
	user = &domain.User{Username: "admin", Password: "hashed-password", BuiltIn: true, AuthType: domain.AuthTypeLocal}
	if err := repo.Initialize(t.Context(), user); err != nil {
		t.Fatalf("initialization could not retry after rollback: %v", err)
	}
}
