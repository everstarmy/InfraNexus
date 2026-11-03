package service

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"infranexus/internal/core/secret"
	"infranexus/internal/domain"
)

type incompleteDirectory struct {
	domain.DirectoryGateway
	failure error
}

func (d incompleteDirectory) SearchUsers(context.Context, *domain.LDAPConfig, string, *time.Time) ([]domain.DirectoryUser, error) {
	return []domain.DirectoryUser{{Username: "only-first-page", ExternalID: "first-id"}}, d.failure
}

type incompleteSearchUsers struct {
	domain.UserRepository
	reads int
}

func (u *incompleteSearchUsers) ListByDomain(context.Context, string) ([]domain.User, error) {
	u.reads++
	return nil, errors.New("must not read users after incomplete directory search")
}

func TestLDAPIncompleteSearchCannotPlanMissingUserDisables(t *testing.T) {
	for _, failure := range []error{context.DeadlineExceeded, errors.Join(domain.ErrDirectoryUnavailable, errors.New("connection lost after first page"))} {
		t.Run(failure.Error(), func(t *testing.T) {
			cipher, err := secret.New(secret.DevKey)
			if err != nil {
				t.Fatal(err)
			}
			users := &incompleteSearchUsers{}
			svc := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Users: users, Gateway: incompleteDirectory{failure: failure}, Cipher: cipher, Logger: slog.New(slog.DiscardHandler)}}
			cfg := &domain.LDAPConfig{Domain: "corp.test", DisableMissingUsers: true}
			planned, summary, departments, fingerprint, err := svc.plan(t.Context(), cfg, domain.SyncModeFull, nil)
			if err == nil || len(planned) != 0 || summary.Disable != 0 || len(departments) != 0 || fingerprint != "" || users.reads != 0 {
				t.Fatalf("incomplete search continued: plans=%d disables=%d departments=%d fingerprint=%q localReads=%d err=%v", len(planned), summary.Disable, len(departments), fingerprint, users.reads, err)
			}
		})
	}
}
