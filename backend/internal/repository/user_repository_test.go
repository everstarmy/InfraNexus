package repository

import (
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
	"infranexus/internal/testdb"
)

func TestCreateWithRolesRollsBackUserWhenRoleIsMissing(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
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
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard, TranslateError: true})
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

func TestUpdateColumnsCASRejectsStaleRevision(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
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

func TestUpdateStatusDialectRegression(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	user := domain.User{Username: "status-" + uuid.NewString(), Email: uuid.NewString() + "@example.test", Password: "hash", AuthType: domain.AuthTypeLocal, Status: domain.StatusEnabled, EditRevision: 1, AuthVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	repo := NewUserRepository(db)
	for _, want := range []struct {
		status      int
		revision    int64
		authVersion int64
	}{{domain.StatusDisabled, 2, 2}, {domain.StatusEnabled, 3, 2}, {domain.StatusEnabled, 4, 2}} {
		if err := repo.UpdateStatus(t.Context(), user.ID, want.status, user.EditRevision); err != nil {
			t.Fatalf("UpdateStatus(%d): %v", want.status, err)
		}
		if err := db.First(&user, "id = ?", user.ID).Error; err != nil {
			t.Fatal(err)
		}
		if user.Status != want.status || user.EditRevision != want.revision || int64(user.AuthVersion) != want.authVersion {
			t.Fatalf("status/revisions = %d/%d/%d, want %d/%d/%d", user.Status, user.EditRevision, user.AuthVersion, want.status, want.revision, want.authVersion)
		}
	}
	if err := repo.UpdateStatus(t.Context(), user.ID, domain.StatusDisabled, 1); !errors.Is(err, domain.ErrEditRevisionConflict) {
		t.Fatalf("stale revision: %v", err)
	}
}
