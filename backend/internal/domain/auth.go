package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Session struct {
	ID                string    `json:"id"`
	UserID            uuid.UUID `json:"user_id"`
	CreatedAt         time.Time `json:"created_at"`
	ExpiresAt         time.Time `json:"expires_at"`
	AbsoluteExpiresAt time.Time `json:"absolute_expires_at"`
	IdleTimeout       int64     `json:"idle_timeout,omitempty"` // 毫秒，0 表示跟随系统默认
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

type Principal struct {
	UserID    uuid.UUID
	Username  string
	Roles     []string
	SessionID string
	FamilyID  string
}

type CurrentUser struct {
	*User
	Permissions []string `json:"permissions"`
	IsAdmin     bool     `json:"is_admin"`
}

type LoginInput struct {
	Username string
	Password string
	Domain   string
}

type AuthService interface {
	Login(ctx context.Context, in LoginInput, oldSessionID string) (*User, *Session, error)
	IssueTokens(ctx context.Context, in LoginInput) (*TokenPair, error)
	Domains(ctx context.Context) ([]AuthDomain, error)
	RefreshToken(ctx context.Context, refreshToken string) (*TokenPair, error)
	AuthenticateSession(ctx context.Context, sessionID string) (*Principal, time.Time, error)
	AuthenticateBearer(ctx context.Context, token string) (*Principal, error)
	Logout(ctx context.Context, principal *Principal) error
	CurrentUser(ctx context.Context, id uuid.UUID) (*User, error)
	Profile(ctx context.Context, id uuid.UUID) (*CurrentUser, error)
	UpdateSessionIdle(ctx context.Context, sessionID string, seconds int) error
}

type AuthRepository interface {
	SaveSession(ctx context.Context, session Session, oldID string) error
	RenewSession(ctx context.Context, id string, now time.Time, idle time.Duration) (*Session, error)
	UpdateSessionIdle(ctx context.Context, id string, idleMs int64, defaultIdleMs int64) error
	DeleteSession(ctx context.Context, id string) error
	CreateFamily(ctx context.Context, familyID, refreshID string, expiresAt time.Time) error
	CheckFamily(ctx context.Context, familyID string) (bool, error)
	RotateFamily(ctx context.Context, familyID, oldRefreshID, newRefreshID string, expiresAt time.Time) (bool, error)
	RevokeFamily(ctx context.Context, familyID string) error
}
