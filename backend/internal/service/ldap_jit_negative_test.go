package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
	"infranexus/internal/repository"
)

type failingJITRepository struct {
	domain.UserRepository
	stage   string
	failure error
	creates int
}

func (r *failingJITRepository) GetByExternalID(ctx context.Context, d, id string) (*domain.User, error) {
	if r.stage == "external" {
		return nil, r.failure
	}
	return r.UserRepository.GetByExternalID(ctx, d, id)
}
func (r *failingJITRepository) GetByUsername(ctx context.Context, d, name string) (*domain.User, error) {
	if r.stage == "username" {
		return nil, r.failure
	}
	return r.UserRepository.GetByUsername(ctx, d, name)
}
func (r *failingJITRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	if r.stage == "email" {
		return nil, r.failure
	}
	return r.UserRepository.GetByEmail(ctx, email)
}
func (r *failingJITRepository) CreateWithRoles(ctx context.Context, u *domain.User, roles []uuid.UUID) error {
	r.creates++
	if r.stage == "create" {
		return r.failure
	}
	return r.UserRepository.CreateWithRoles(ctx, u, roles)
}
func jitNegativeDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "jit.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.AutoMigrate(&domain.User{}, &domain.Role{}, &domain.Department{}); err != nil {
		t.Fatal(err)
	}
	return db
}
func TestLDAPJITPropagatesDatabaseFailuresWithoutProvisioning(t *testing.T) {
	for _, stage := range []string{"external", "username", "email", "create"} {
		t.Run(stage, func(t *testing.T) {
			db := jitNegativeDatabase(t)
			failure := errors.New("injected database failure")
			users := &failingJITRepository{UserRepository: repository.NewUserRepository(db), stage: stage, failure: failure}
			svc := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Users: users}}
			user, err := svc.provision(t.Context(), &domain.LDAPConfig{Domain: "corp.test", Type: domain.AuthTypeLDAP}, domain.DirectoryUser{Username: "alice", Email: "alice@corp.test", ExternalID: "alice-id"})
			wantCreates := 0
			if stage == "create" {
				wantCreates = 1
			}
			if user != nil || !errors.Is(err, failure) || users.creates != wantCreates {
				t.Fatalf("user=%v err=%v creates=%d, want propagated error and creates=%d", user, err, users.creates, wantCreates)
			}
			var count int64
			if err := db.Model(&domain.User{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("failed JIT left %d users", count)
			}
		})
	}
}
func TestLDAPJITEmailCollisionNeverBindsOrOverwritesOwner(t *testing.T) {
	db := jitNegativeDatabase(t)
	repo := repository.NewUserRepository(db)
	owner := &domain.User{Username: "owner", Email: "shared@corp.test", AuthType: domain.AuthTypeLocal, Status: domain.StatusEnabled}
	if err := repo.Create(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	svc := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Users: repo}}
	user, err := svc.provision(t.Context(), &domain.LDAPConfig{Domain: "corp.test", Type: domain.AuthTypeLDAP}, domain.DirectoryUser{Username: "alice", Email: owner.Email, ExternalID: "alice-id"})
	if err != nil || user == nil {
		t.Fatalf("provision: %v", err)
	}
	if user.ID == owner.ID || user.ExternalID != "alice-id" || user.Email != "" {
		t.Fatalf("email collision resolved to wrong identity: %+v", user)
	}
	stored, err := repo.GetByID(t.Context(), owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Email != owner.Email || stored.AuthType != domain.AuthTypeLocal || stored.ExternalID != "" {
		t.Fatalf("email owner altered: %+v", stored)
	}
}
func TestLDAPJITDoesNotReactivateDisabledIdentity(t *testing.T) {
	db := jitNegativeDatabase(t)
	repo := repository.NewUserRepository(db)
	disabled := &domain.User{Username: "alice", Domain: "corp.test", ExternalID: "alice-id", AuthType: domain.AuthTypeLDAP, Status: domain.StatusDisabled}
	if err := repo.Create(t.Context(), disabled); err != nil {
		t.Fatal(err)
	}
	svc := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Users: repo}}
	user, err := svc.provision(t.Context(), &domain.LDAPConfig{Domain: "corp.test", Type: domain.AuthTypeLDAP}, domain.DirectoryUser{Username: "alice", ExternalID: "alice-id"})
	if user != nil || coreerrors.Classify(err).BizCode != coreerrors.ErrAccountDisabled.BizCode {
		t.Fatalf("user=%v err=%v, want account disabled", user, err)
	}
	stored, err := repo.GetByID(t.Context(), disabled.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != domain.StatusDisabled {
		t.Fatal("JIT reactivated disabled identity")
	}
}
