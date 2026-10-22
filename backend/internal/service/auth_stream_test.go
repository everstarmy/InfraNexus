package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type streamUserRepository struct {
	domain.UserRepository
	user *domain.User
}

func (r streamUserRepository) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	if r.user == nil || r.user.ID != id {
		return nil, coreerrors.ErrUnauthorized
	}
	return r.user, nil
}

type streamAuthRepository struct {
	domain.AuthRepository
	session     *domain.Session
	renewCalls  int
	checkFamily bool
}

func (r *streamAuthRepository) GetSession(context.Context, string) (*domain.Session, error) {
	return r.session, nil
}

func (r *streamAuthRepository) RenewSession(context.Context, string, time.Time, time.Duration) (*domain.Session, error) {
	r.renewCalls++
	return r.session, nil
}

func (r *streamAuthRepository) CheckFamily(context.Context, string) (bool, error) {
	return r.checkFamily, nil
}

func TestValidateStreamPrincipalRechecksSessionWithoutRenewal(t *testing.T) {
	now := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	userID := uuid.New()
	session := &domain.Session{
		ID: "stream-session", UserID: userID, AuthVersion: 3,
		CreatedAt: now.Add(-time.Hour), ExpiresAt: now.Add(time.Hour), AbsoluteExpiresAt: now.Add(4 * time.Hour),
	}
	user := &domain.User{BaseEntity: domain.BaseEntity{ID: userID}, Username: "stream-user", Status: domain.StatusEnabled, AuthVersion: 3}
	store := &streamAuthRepository{session: session}
	service := NewAuthService(nil, streamUserRepository{user: user}, store, nil, nil, nil).(*authService)
	service.now = func() time.Time { return now }
	principal := &domain.Principal{UserID: userID, AuthVersion: 3, SessionID: session.ID, ExpiresAt: now.Add(2 * time.Hour)}

	validated, err := service.ValidateStreamPrincipal(t.Context(), principal)
	if err != nil {
		t.Fatalf("valid session rejected: %v", err)
	}
	if validated.ExpiresAt != session.ExpiresAt || validated.IssuedAt != session.CreatedAt {
		t.Fatalf("validated session lifetime = %s / %s, want stored lifetime", validated.IssuedAt, validated.ExpiresAt)
	}
	if store.renewCalls != 0 {
		t.Fatalf("stream validation renewed session %d times", store.renewCalls)
	}

	t.Run("absolute expiry closes stream", func(t *testing.T) {
		service.now = func() time.Time { return session.ExpiresAt }
		if _, err := service.ValidateStreamPrincipal(t.Context(), principal); !errors.Is(err, coreerrors.ErrUnauthorized) {
			t.Fatalf("ValidateStreamPrincipal() error = %v, want unauthorized", err)
		}
		service.now = func() time.Time { return now }
	})
	t.Run("deleted session closes stream", func(t *testing.T) {
		store.session = nil
		if _, err := service.ValidateStreamPrincipal(t.Context(), principal); !errors.Is(err, coreerrors.ErrSessionRevoked) {
			t.Fatalf("ValidateStreamPrincipal() error = %v, want session revoked", err)
		}
	})
	t.Run("auth version change closes stream", func(t *testing.T) {
		store.session = session
		user.AuthVersion++
		if _, err := service.ValidateStreamPrincipal(t.Context(), principal); !errors.Is(err, coreerrors.ErrSessionRevoked) {
			t.Fatalf("ValidateStreamPrincipal() error = %v, want session revoked", err)
		}
	})
}
