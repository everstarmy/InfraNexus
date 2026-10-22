package repository

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

func TestCreateWithRolesRollsBackUserWhenRoleIsMissing(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "user-roles.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	repo := NewUserRepository(db)
	user := &domain.User{Username: "atomic-user", Email: "atomic@example.test", Password: "hash", AuthType: domain.AuthTypeLocal, Status: domain.StatusEnabled}
	err = repo.CreateWithRoles(t.Context(), user, []uuid.UUID{uuid.New()})
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing role result = %v, want not found", err)
	}
	var count int64
	if err := db.Model(&domain.User{}).Where("username = ?", user.Username).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("transaction left a partial user row: %d", count)
	}
}

func TestCreateWithRolesMapsConcurrentIdentityWinner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "user-identity-race.db")
	db, err := gorm.Open(sqlite.Open("file:"+path+"?_busy_timeout=5000"), &gorm.Config{Logger: logger.Discard, TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	repo := NewUserRepository(db)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			user := &domain.User{Username: "same-directory-user", Domain: "corp.example", ExternalID: "stable-guid", Email: "same-directory@example.test", AuthType: domain.AuthTypeLDAP, Status: domain.StatusEnabled, Password: ""}
			results <- repo.CreateWithRoles(t.Context(), user, nil)
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	created, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			created++
		case errors.Is(err, domain.ErrIdentityConflict):
			conflicts++
		default:
			t.Fatalf("CreateWithRoles() error = %v, want a committed winner and typed identity conflict", err)
		}
	}
	if created != 1 || conflicts != 1 {
		t.Fatalf("concurrent create results = created %d, conflicts %d; want one each", created, conflicts)
	}
	var count int64
	if err := db.Model(&domain.User{}).Where("domain = ? AND username = ?", "corp.example", "same-directory-user").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("concurrent JIT left %d user rows, want one", count)
	}
}

func TestCreateWithRolesMapsConcurrentIdentityWinnerPostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard, TranslateError: true})
	if err != nil {
		t.Fatalf("connect test PostgreSQL database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	repo := NewUserRepository(db)
	username := "race-" + uuid.NewString()[:8]
	domainName := "corp-" + uuid.NewString()[:8]
	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			user := &domain.User{Username: username, Domain: domainName, ExternalID: "stable-guid", Email: username + "@example.test", AuthType: domain.AuthTypeLDAP, Status: domain.StatusEnabled}
			results <- repo.CreateWithRoles(t.Context(), user, nil)
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	created, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			created++
		case errors.Is(err, domain.ErrIdentityConflict):
			conflicts++
		default:
			t.Fatalf("CreateWithRoles() error = %v, want a committed winner and typed identity conflict", err)
		}
	}
	if created != 1 || conflicts != 1 {
		t.Fatalf("concurrent create results = created %d, conflicts %d; want one each", created, conflicts)
	}
}

func TestUpdateColumnsCASRejectsStaleRevision(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "user-revision.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&domain.User{}); err != nil {
		t.Fatal(err)
	}
	repo := NewUserRepository(db)
	user := &domain.User{Username: "revision-user", Email: "revision@example.test", Password: "hash", AuthType: domain.AuthTypeLocal, Status: domain.StatusEnabled}
	if err := repo.Create(t.Context(), user); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateColumnsCAS(t.Context(), user.ID, user.EditRevision, map[string]any{"nickname": "first"}); err != nil {
		t.Fatalf("update at current revision: %v", err)
	}
	if err := repo.UpdateColumnsCAS(t.Context(), user.ID, user.EditRevision, map[string]any{"nickname": "stale"}); !errors.Is(err, domain.ErrEditRevisionConflict) {
		t.Fatalf("stale update error = %v, want edit revision conflict", err)
	}
	current, err := repo.GetByID(t.Context(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Nickname != "first" || current.EditRevision != user.EditRevision+1 {
		t.Fatalf("stale update changed row: nickname=%q revision=%d", current.Nickname, current.EditRevision)
	}
}
