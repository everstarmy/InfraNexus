package service

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"infranexus/internal/config"
	corelogger "infranexus/internal/core/logger"
	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/testdb"
)

func TestAuthorizationWorkerIdleSQLLogging(t *testing.T) {
	var logs bytes.Buffer
	settings := config.DefaultLogging(true, "test").SQL
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: corelogger.NewGORM(log, settings, "postgres")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.AuthorizationOutbox{}); err != nil {
		t.Fatal(err)
	}
	state := repository.NewAuthorizationStateRepository(db)
	notifier := &testAuthorizationNotifier{}
	worker := &authorizationService{state: state, notifier: notifier}
	ctx := requestmeta.WithTask(t.Context(), "idle-worker", "")
	logs.Reset()
	// The real worker tick calls this method; repeat without wall-clock sleeps.
	for range 3 {
		if err := worker.publishPending(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if logs.Len() != 0 {
		t.Fatalf("idle worker SQL flooded logs: %s", logs.String())
	}
	row := domain.AuthorizationOutbox{Revision: 1, Event: "authorization.changed", NextAttemptAt: time.Now().Add(-time.Second)}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	logs.Reset()
	if err := worker.publishPending(ctx); err != nil {
		t.Fatal(err)
	}
	if len(notifier.published) != 1 || !strings.Contains(logs.String(), "db.query") {
		t.Fatalf("useful work hidden: published=%v logs=%s", notifier.published, logs.String())
	}
	logs.Reset()
	requestCtx := requestmeta.WithRequestID(ctx, "request-empty")
	if _, err := state.Pending(requestCtx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(logs.String(), "request-empty") {
		t.Fatalf("ordinary request query hidden: %s", logs.String())
	}
	if err := db.Migrator().DropTable(&domain.AuthorizationOutbox{}); err != nil {
		t.Fatal(err)
	}
	logs.Reset()
	if err := worker.publishPending(ctx); err == nil {
		t.Fatal("missing table error swallowed")
	}
	if !strings.Contains(logs.String(), "db.query_failed") {
		t.Fatalf("poll error hidden: %s", logs.String())
	}
}
