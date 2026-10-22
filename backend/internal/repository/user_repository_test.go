package repository

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
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
