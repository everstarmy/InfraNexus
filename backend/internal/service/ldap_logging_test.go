package service

import (
	"context"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"infranexus/internal/config"
	"infranexus/internal/core/logger"
	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
)

type correlatedProgressRepository struct {
	terminalProgressRepository
	request, task, operator string
}

func (r *correlatedProgressRepository) SaveLogIfOwner(ctx context.Context, log *domain.LDAPSyncLog, now time.Time) (bool, error) {
	r.request, r.task, r.operator = requestmeta.RequestID(ctx), requestmeta.TaskID(ctx), requestmeta.OperatorID(ctx)
	return r.terminalProgressRepository.SaveLogIfOwner(ctx, log, now)
}

func TestLDAPTaskRestoresPersistedLogCorrelation(t *testing.T) {
	for _, requestID := range []string{"originating-request", ""} {
		t.Run("request-"+requestID, func(t *testing.T) {
			c := &config.Config{Logging: config.DefaultLogging(false, "test")}
			c.Logging.Output = "file"
			c.Logging.File.Directory = t.TempDir()
			logs, err := logger.New(c)
			if err != nil {
				t.Fatal(err)
			}
			defer logs.Close()
			now := time.Now()
			operator := uuid.New()
			id := uuid.New()
			task := &domain.LDAPSyncLog{BaseEntity: domain.BaseEntity{ID: id}, StartedAt: now, RequestID: requestID, OperatorID: &operator}
			repo := &correlatedProgressRepository{}
			s := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Repo: repo, Logger: logs.Logger}, ctx: t.Context(), now: func() time.Time { return now }}
			s.runSync(&domain.LDAPConfig{}, task, nil, domain.SyncSummary{}, 0)
			if repo.request != requestID || repo.task != id.String() || repo.operator != operator.String() {
				t.Fatalf("task context lost: %+v", repo)
			}
			data, err := os.ReadFile(filepath.Join(logs.Directory, "app.log"))
			if err != nil {
				t.Fatal(err)
			}
			var row map[string]any
			if err := json.Unmarshal([]byte(strings.TrimSpace(string(data))), &row); err != nil {
				t.Fatal(err)
			}
			if row["task_id"] != id.String() || row["operator_id"] != operator.String() {
				t.Fatalf("task log: %+v", row)
			}
			if requestID == "" {
				if _, exists := row["request_id"]; exists {
					t.Fatal("fabricated scheduler request")
				}
			} else if row["request_id"] != requestID {
				t.Fatal("lost originating request")
			}
		})
	}
}
