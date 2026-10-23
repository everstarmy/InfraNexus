package service

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"infranexus/internal/config"
	corelogger "infranexus/internal/core/logger"
	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
	"infranexus/internal/repository"
)

func TestAuthorizationWorkerIdleSQLLogging(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			var dialector gorm.Dialector
			if driver == "postgres" {
				dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN for isolated PostgreSQL")
				}
				dialector = postgres.Open(dsn)
			} else {
				dialector = sqlite.Open(filepath.Join(t.TempDir(), "idle.db"))
			}
			var logs bytes.Buffer
			settings := config.DefaultLogging(true, "test").SQL
			log := slog.New(slog.NewJSONHandler(&logs, nil))
			db, err := gorm.Open(dialector, &gorm.Config{Logger: corelogger.NewGORM(log, settings, driver)})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = sqlDB.Close() })
			if driver == "postgres" {
				schema := "idle_" + strings.ReplaceAll(uuid.NewString(), "-", "")
				if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec("SET search_path TO " + schema).Error; err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Exec("DROP SCHEMA " + schema + " CASCADE").Error })
			}
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
		})
	}
}
