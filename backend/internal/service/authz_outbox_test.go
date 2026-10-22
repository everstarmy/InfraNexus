package service

import (
	"context"
	"errors"
	"path/filepath"
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
)

type testAuthorizationNotifier struct {
	failures  int
	published []int64
}

func (n *testAuthorizationNotifier) Publish(_ context.Context, revision int64) error {
	if n.failures > 0 {
		n.failures--
		return errors.New("redis unavailable")
	}
	n.published = append(n.published, revision)
	return nil
}

func (*testAuthorizationNotifier) Subscribe(context.Context) (<-chan int64, error) {
	return nil, errors.New("not used by this test")
}

type failedAuthorizationState struct{ err error }

func (s failedAuthorizationState) Revision(context.Context) (int64, error) {
	return 0, s.err
}
func (failedAuthorizationState) Pending(context.Context, time.Time, int) ([]domain.AuthorizationOutbox, error) {
	return nil, nil
}
func (failedAuthorizationState) MarkPublished(context.Context, uuid.UUID, time.Time) error {
	return nil
}
func (failedAuthorizationState) MarkFailed(context.Context, uuid.UUID, string, time.Time) error {
	return nil
}

type fixedAuthorizationState struct{ revision int64 }

func (s fixedAuthorizationState) Revision(context.Context) (int64, error) { return s.revision, nil }
func (fixedAuthorizationState) Pending(context.Context, time.Time, int) ([]domain.AuthorizationOutbox, error) {
	return nil, nil
}
func (fixedAuthorizationState) MarkPublished(context.Context, uuid.UUID, time.Time) error { return nil }
func (fixedAuthorizationState) MarkFailed(context.Context, uuid.UUID, string, time.Time) error {
	return nil
}

func TestAuthorizationOutboxRetriesPublishFailureAndMarksSuccess(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "authorization-outbox.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.AuthorizationState{}, &domain.AuthorizationOutbox{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.AuthorizationState{ID: domain.AuthorizationStateID, Revision: 2}).Error; err != nil {
		t.Fatal(err)
	}
	row := domain.AuthorizationOutbox{Revision: 2, CreatedAt: time.Now().Add(-time.Second), NextAttemptAt: time.Now().Add(-time.Second)}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	notifier := &testAuthorizationNotifier{failures: 1}
	worker := NewAuthorizationService(nil, nil, nil, repository.NewAuthorizationStateRepository(db), notifier, nil).(*authorizationService)
	ctx := t.Context()
	if err := worker.publishPending(ctx); err != nil {
		t.Fatal(err)
	}
	var stored domain.AuthorizationOutbox
	if err := db.First(&stored, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AttemptCount != 1 || stored.LastError != "redis unavailable" || !stored.NextAttemptAt.After(time.Now()) {
		t.Fatalf("failed outbox state = attempts %d, error %q, next %s", stored.AttemptCount, stored.LastError, stored.NextAttemptAt)
	}
	if len(notifier.published) != 0 {
		t.Fatalf("failed publish was recorded as delivered: %v", notifier.published)
	}

	if err := db.Model(&domain.AuthorizationOutbox{}).Where("id = ?", row.ID).Update("next_attempt_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := worker.publishPending(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&stored, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ProcessedAt == nil || stored.LastError != "" {
		t.Fatalf("successful outbox state = processed %v, error %q", stored.ProcessedAt, stored.LastError)
	}
	if len(notifier.published) != 1 || notifier.published[0] != row.Revision {
		t.Fatalf("published revisions = %v, want [%d]", notifier.published, row.Revision)
	}
	if err := worker.publishPending(ctx); err != nil {
		t.Fatal(err)
	}
	if len(notifier.published) != 1 {
		t.Fatalf("processed outbox was published again: %v", notifier.published)
	}
}

func TestAuthorizationEnforcementFailsClosedWhenRevisionCannotBeRead(t *testing.T) {
	wantErr := errors.New("database unavailable")
	service := NewAuthorizationService(nil, nil, nil, failedAuthorizationState{err: wantErr}, nil, nil)
	allowed, err := service.Enforce(t.Context(), "operator", "/api/v1/users", "GET")
	if allowed || !errors.Is(err, wantErr) {
		t.Fatalf("Enforce() = (%v, %v), want denied with revision error", allowed, err)
	}
}

func TestAuthorizationEnforcementFailsClosedWhenPolicyReloadFails(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "authorization-load-failure.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := gormadapter.NewAdapterByDB(db)
	if err != nil {
		t.Fatal(err)
	}
	policyModel, err := model.NewModelFromString(middleware.RBACModel)
	if err != nil {
		t.Fatal(err)
	}
	enforcer, err := casbin.NewSyncedEnforcer(policyModel, adapter)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}

	service := NewAuthorizationService(enforcer, nil, nil, fixedAuthorizationState{revision: 2}, nil, nil)
	allowed, err := service.Enforce(t.Context(), "operator", "/api/v1/users", "GET")
	if allowed || err == nil {
		t.Fatalf("Enforce() = (%v, %v), want denied with a policy load error", allowed, err)
	}
}
