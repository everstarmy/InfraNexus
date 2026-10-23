package service

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"infranexus/internal/domain"
)

type terminalProgressRepository struct {
	domain.LDAPRepository
	snapshots          []domain.LDAPSyncLog
	released           bool
	cancelAfterInitial context.CancelFunc
}

func (r *terminalProgressRepository) SaveLogIfOwner(_ context.Context, log *domain.LDAPSyncLog, _ time.Time) (bool, error) {
	snapshot := *log
	if log.Total != nil {
		snapshot.Total = new(*log.Total)
	}
	r.snapshots = append(r.snapshots, snapshot)
	if len(r.snapshots) == 1 && r.cancelAfterInitial != nil {
		r.cancelAfterInitial()
	}
	return true, nil
}

func (r *terminalProgressRepository) ReleaseSync(context.Context, uuid.UUID, uuid.UUID, string, time.Time, *time.Time) (bool, error) {
	r.released = true
	return true, nil
}

func TestLDAPSyncTerminalProgressBypassesThrottle(t *testing.T) {
	for _, tc := range []struct {
		name              string
		actions           []string
		cancel            bool
		status            string
		processed, failed int
	}{
		{name: "success", actions: []string{domain.SyncActionUnchanged, domain.SyncActionSkip}, status: domain.SyncStatusSuccess, processed: 2},
		{name: "partial", actions: []string{domain.SyncActionUnchanged, domain.SyncActionConflict}, status: domain.SyncStatusPartial, processed: 2, failed: 1},
		{name: "canceled", actions: []string{domain.SyncActionUnchanged}, cancel: true, status: domain.SyncStatusFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			repo := &terminalProgressRepository{}
			if tc.cancel {
				repo.cancelAfterInitial = cancel
			}
			// Frozen time deterministically suppresses all ordinary progress writes.
			now := time.Date(2026, time.October, 23, 0, 0, 0, 0, time.UTC)
			s := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Repo: repo, Logger: slog.New(slog.DiscardHandler)}, ctx: ctx, now: func() time.Time { return now }}
			planned := make([]plannedUser, len(tc.actions))
			for i, action := range tc.actions {
				planned[i].item.Action = action
			}
			log := &domain.LDAPSyncLog{StartedAt: now, Status: domain.SyncStatusRunning}
			s.runSync(&domain.LDAPConfig{}, log, planned, domain.SyncSummary{Total: len(planned)}, len(planned))
			if len(repo.snapshots) != 2 || !repo.released {
				t.Fatalf("snapshots=%d released=%t; want initial and terminal writes plus lease release", len(repo.snapshots), repo.released)
			}
			terminal := repo.snapshots[1]
			if terminal.Processed != tc.processed || terminal.Total == nil || *terminal.Total != len(planned) {
				t.Fatalf("terminal processed=%d total=%v; want processed=%d total=%d", terminal.Processed, terminal.Total, tc.processed, len(planned))
			}
			report := terminal.Report.Data()
			classified := report.Created + report.Updated + report.Unchanged + report.Disabled + report.Skipped + report.Failed
			if terminal.Phase != domain.SyncPhaseFinalizing || terminal.Status != tc.status || report.Failed != tc.failed || classified != tc.processed {
				t.Fatalf("terminal phase=%s status=%s failed=%d classified=%d", terminal.Phase, terminal.Status, report.Failed, classified)
			}
		})
	}
}
