package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"infranexus/internal/config"
	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type JWTClaims struct {
	Purpose     string `json:"purpose"`
	FamilyID    string `json:"family_id"`
	AuthVersion int64  `json:"auth_version"`
	jwt.RegisteredClaims
}
type authService struct {
	cfg       *config.Config
	users     domain.UserRepository
	store     domain.AuthRepository
	authz     domain.AuthorizationService
	directory domain.DirectoryAuthenticator
	logger    *slog.Logger
	now       func() time.Time
}

func NewAuthService(cfg *config.Config, users domain.UserRepository, store domain.AuthRepository, authz domain.AuthorizationService, directory domain.DirectoryAuthenticator, logger *slog.Logger) domain.AuthService {
	if logger == nil {
		logger = slog.Default()
	}
	return &authService{cfg: cfg, users: users, store: store, authz: authz, directory: directory, logger: logger.With("component", "auth_service"), now: time.Now}
}

func (s *authService) Domains(ctx context.Context) ([]domain.AuthDomain, error) {
	if s.directory == nil {
		return []domain.AuthDomain{}, nil
	}
	return s.directory.ListLoginDomains(ctx)
}

func (s *authService) authenticate(ctx context.Context, in domain.LoginInput) (*domain.User, error) {
	authDomain := strings.ToLower(strings.TrimSpace(in.Domain))
	if authDomain == "" || authDomain == "local" {
		return s.credentials(ctx, in.Username, in.Password)
	}
	if s.directory == nil {
		return nil, coreerrors.ErrDomainNotFound
	}
	return s.directory.AuthenticateDomain(ctx, authDomain, in.Username, in.Password)
}

func (s *authService) Profile(ctx context.Context, id uuid.UUID) (*domain.CurrentUser, error) {
	user, err := s.CurrentUser(ctx, id)
	if err != nil {
		return nil, err
	}
	codes, isAdmin, err := s.authz.EffectivePermissions(ctx, principal(user, "", "").Roles)
	if err != nil {
		return nil, err
	}
	return &domain.CurrentUser{User: user, Permissions: codes, IsAdmin: isAdmin}, nil
}
func authStoreError(err error) error {
	return coreerrors.NewDomainError(500, 500002, "认证存储不可用", err)
}
func (s *authService) CurrentUser(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	user, err := s.users.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, coreerrors.ErrUnauthorized
		}
		return nil, authStoreError(err)
	}
	if user == nil || user.Status != 1 {
		return nil, coreerrors.ErrUnauthorized
	}
	return user, nil
}
func (s *authService) credentials(ctx context.Context, username, password string) (*domain.User, error) {
	user, err := s.users.GetByUsername(ctx, "", username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, coreerrors.ErrInvalidCredentials
		}
		return nil, authStoreError(err)
	}
	if user == nil || user.AuthType != domain.AuthTypeLocal {
		return nil, coreerrors.ErrInvalidCredentials
	}
	if user.Status != 1 {
		return nil, coreerrors.ErrAccountDisabled
	}
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)) != nil {
		return nil, coreerrors.ErrInvalidCredentials
	}
	return user, nil
}
func (s *authService) Login(ctx context.Context, in domain.LoginInput, oldID string) (*domain.User, *domain.Session, error) {
	user, err := s.authenticate(ctx, in)
	if err != nil {
		return nil, nil, err
	}
	now := s.now()
	idle := time.Duration(s.cfg.Session.MaxAge) * time.Second
	absolute := time.Duration(s.cfg.Session.AbsoluteMaxAge) * time.Second
	if idle <= 0 || absolute <= 0 {
		return nil, nil, authStoreError(fmt.Errorf("invalid session lifetime"))
	}
	var idleTimeoutMs int64
	if user.Preferences.Data().SessionTimeout > 0 {
		userTimeout := time.Duration(user.Preferences.Data().SessionTimeout) * time.Second
		if userTimeout <= absolute {
			idle = userTimeout
			idleTimeoutMs = idle.Milliseconds()
		}
	}
	id, err := secureToken()
	if err != nil {
		return nil, nil, err
	}
	session := domain.Session{
		ID:                id,
		UserID:            user.ID,
		AuthVersion:       user.AuthVersion,
		CreatedAt:         now,
		ExpiresAt:         now.Add(idle),
		AbsoluteExpiresAt: now.Add(absolute),
		IdleTimeout:       idleTimeoutMs,
	}
	if session.ExpiresAt.After(session.AbsoluteExpiresAt) {
		session.ExpiresAt = session.AbsoluteExpiresAt
	}
	if err = s.store.SaveSession(ctx, session, oldID); err != nil {
		return nil, nil, authStoreError(err)
	}
	s.recordLogin(ctx, user)
	return user, &session, nil
}
func (s *authService) AuthenticateSession(ctx context.Context, id string) (*domain.Principal, time.Time, error) {
	if id == "" {
		return nil, time.Time{}, coreerrors.ErrUnauthorized
	}
	sess, err := s.store.RenewSession(ctx, id, s.now(), time.Duration(s.cfg.Session.MaxAge)*time.Second)
	if err != nil {
		return nil, time.Time{}, authStoreError(err)
	}
	if sess == nil {
		return nil, time.Time{}, coreerrors.ErrUnauthorized
	}
	user, err := s.CurrentUser(ctx, sess.UserID)
	if err != nil {
		return nil, time.Time{}, err
	}
	if sess.AuthVersion < 1 || sess.AuthVersion != user.AuthVersion {
		if err := s.store.DeleteSession(ctx, id); err != nil {
			s.logger.WarnContext(ctx, "Delete revoked session failed", "event", "auth.revoked_session_cleanup_failed", "operation", "delete_revoked_session", "error_type", fmt.Sprintf("%T", err))
		}
		return nil, time.Time{}, coreerrors.ErrSessionRevoked
	}
	if revokedBefore(user, sess.CreatedAt, time.Millisecond) {
		if err := s.store.DeleteSession(ctx, id); err != nil {
			s.logger.WarnContext(ctx, "Delete revoked session failed", "event", "auth.revoked_session_cleanup_failed", "operation", "delete_revoked_session", "error_type", fmt.Sprintf("%T", err))
		}
		return nil, time.Time{}, coreerrors.ErrSessionRevoked
	}
	current := principal(user, id, "")
	current.ExpiresAt = sess.ExpiresAt
	current.IssuedAt = sess.CreatedAt
	return current, sess.ExpiresAt, nil
}

func revokedBefore(user *domain.User, issuedAt time.Time, precision time.Duration) bool {
	return user.SessionsRevokedAt != nil && issuedAt.Before(user.SessionsRevokedAt.Truncate(precision))
}

func (s *authService) recordLogin(ctx context.Context, user *domain.User) {
	if err := s.users.UpdateColumns(ctx, user.ID, map[string]any{"last_login_at": s.now()}); err != nil {
		s.logger.WarnContext(ctx, "Update last login timestamp failed", "event", "auth.last_login_update_failed", "operation", "update_last_login", "user_id", user.ID, "error_type", fmt.Sprintf("%T", err))
	}
}
func principal(user *domain.User, sessionID, familyID string) *domain.Principal {
	p := &domain.Principal{UserID: user.ID, Username: user.Username, AuthVersion: user.AuthVersion, SessionID: sessionID, FamilyID: familyID}
	for _, role := range user.Roles {
		if role.Status == 1 {
			p.Roles = append(p.Roles, role.Code)
		}
	}
	return p
}
func (s *authService) IssueTokens(ctx context.Context, in domain.LoginInput) (*domain.TokenPair, error) {
	user, err := s.authenticate(ctx, in)
	if err != nil {
		return nil, err
	}
	family, err := secureToken()
	if err != nil {
		return nil, err
	}
	pair, refreshID, expiry, err := s.makePair(user.ID, user.AuthVersion, family, time.Time{})
	if err != nil {
		return nil, err
	}
	if err = s.store.CreateFamily(ctx, family, refreshID, expiry); err != nil {
		return nil, authStoreError(err)
	}
	s.recordLogin(ctx, user)
	return pair, nil
}
func (s *authService) parse(tokenStr, purpose string) (*JWTClaims, error) {
	if tokenStr == "" {
		return nil, coreerrors.ErrUnauthorized
	}
	claims := new(JWTClaims)
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) { return []byte(s.cfg.JWT.Secret), nil }, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(s.cfg.JWT.Issuer), jwt.WithExpirationRequired())
	if err != nil || !token.Valid || claims.Purpose != purpose || claims.ID == "" || claims.FamilyID == "" || claims.Subject == "" || claims.IssuedAt == nil || claims.AuthVersion < 1 {
		return nil, coreerrors.ErrUnauthorized
	}
	if _, err = uuid.Parse(claims.Subject); err != nil {
		return nil, coreerrors.ErrUnauthorized
	}
	return claims, nil
}
func (s *authService) AuthenticateBearer(ctx context.Context, token string) (*domain.Principal, error) {
	claims, err := s.parse(token, "access")
	if err != nil {
		return nil, err
	}
	valid, err := s.store.CheckFamily(ctx, claims.FamilyID)
	if err != nil {
		return nil, authStoreError(err)
	}
	if !valid {
		return nil, coreerrors.ErrUnauthorized
	}
	id, _ := uuid.Parse(claims.Subject)
	user, err := s.CurrentUser(ctx, id)
	if err != nil {
		return nil, err
	}
	if claims.AuthVersion != user.AuthVersion {
		return nil, coreerrors.ErrSessionRevoked
	}
	if revokedBefore(user, claims.IssuedAt.Time, time.Second) {
		return nil, coreerrors.ErrSessionRevoked
	}
	current := principal(user, "", claims.FamilyID)
	current.ExpiresAt = claims.ExpiresAt.Time
	current.IssuedAt = claims.IssuedAt.Time
	return current, nil
}

func (s *authService) ValidateStreamPrincipal(ctx context.Context, current *domain.Principal) (*domain.Principal, error) {
	if current == nil || current.UserID == uuid.Nil || (!current.ExpiresAt.IsZero() && !s.now().Before(current.ExpiresAt)) {
		return nil, coreerrors.ErrUnauthorized
	}
	user, err := s.CurrentUser(ctx, current.UserID)
	if err != nil {
		return nil, err
	}
	if current.AuthVersion < 1 || current.AuthVersion != user.AuthVersion {
		return nil, coreerrors.ErrSessionRevoked
	}
	updated := principal(user, current.SessionID, current.FamilyID)
	updated.ExpiresAt = current.ExpiresAt
	updated.IssuedAt = current.IssuedAt
	if current.SessionID != "" {
		session, err := s.store.GetSession(ctx, current.SessionID)
		if err != nil {
			return nil, authStoreError(err)
		}
		if session == nil || session.UserID != current.UserID || session.AuthVersion != current.AuthVersion || revokedBefore(user, session.CreatedAt, time.Millisecond) {
			return nil, coreerrors.ErrSessionRevoked
		}
		updated.ExpiresAt = session.ExpiresAt
		updated.IssuedAt = session.CreatedAt
	} else if current.FamilyID != "" {
		valid, err := s.store.CheckFamily(ctx, current.FamilyID)
		if err != nil {
			return nil, authStoreError(err)
		}
		if !valid || revokedBefore(user, current.IssuedAt, time.Second) {
			return nil, coreerrors.ErrSessionRevoked
		}
	} else {
		return nil, coreerrors.ErrUnauthorized
	}
	if !s.now().Before(updated.ExpiresAt) {
		return nil, coreerrors.ErrUnauthorized
	}
	return updated, nil
}
func (s *authService) RefreshToken(ctx context.Context, token string) (*domain.TokenPair, error) {
	claims, err := s.parse(token, "refresh")
	if err != nil {
		return nil, err
	}
	id, _ := uuid.Parse(claims.Subject)
	user, err := s.CurrentUser(ctx, id)
	if err != nil {
		return nil, err
	}
	if claims.AuthVersion != user.AuthVersion {
		return nil, coreerrors.ErrSessionRevoked
	}
	if revokedBefore(user, claims.IssuedAt.Time, time.Second) {
		return nil, coreerrors.ErrSessionRevoked
	}
	pair, nextID, _, err := s.makePair(user.ID, user.AuthVersion, claims.FamilyID, claims.ExpiresAt.Time)
	if err != nil {
		return nil, err
	}
	ok, err := s.store.RotateFamily(ctx, claims.FamilyID, claims.ID, nextID, time.Time{})
	if err != nil {
		return nil, authStoreError(err)
	}
	if !ok {
		return nil, coreerrors.ErrUnauthorized
	}
	return pair, nil
}
func (s *authService) Logout(ctx context.Context, p *domain.Principal) error {
	if p == nil {
		return coreerrors.ErrUnauthorized
	}
	if p.FamilyID != "" {
		if err := s.store.RevokeFamily(ctx, p.FamilyID); err != nil {
			return authStoreError(err)
		}
	}
	if p.SessionID != "" {
		if err := s.store.DeleteSession(ctx, p.SessionID); err != nil {
			return authStoreError(err)
		}
	}
	return nil
}
func (s *authService) UpdateSessionIdle(ctx context.Context, sessionID string, seconds int) error {
	if sessionID == "" {
		return nil
	}
	var idleMs int64
	if seconds > 0 {
		idleMs = int64(seconds) * 1000
	}
	defaultIdleMs := int64(s.cfg.Session.MaxAge) * 1000
	return s.store.UpdateSessionIdle(ctx, sessionID, idleMs, defaultIdleMs)
}
func (s *authService) makePair(id uuid.UUID, authVersion int64, family string, familyExpiry time.Time) (*domain.TokenPair, string, time.Time, error) {
	now := s.now()
	accessID, err := secureToken()
	if err != nil {
		return nil, "", time.Time{}, err
	}
	refreshID, err := secureToken()
	if err != nil {
		return nil, "", time.Time{}, err
	}
	accessExpiry := now.Add(time.Duration(s.cfg.JWT.AccessTokenExpire) * time.Second)
	refreshExpiry := now.Add(time.Duration(s.cfg.JWT.RefreshTokenExpire) * time.Second)
	if !familyExpiry.IsZero() && refreshExpiry.After(familyExpiry) {
		refreshExpiry = familyExpiry
	}
	if accessExpiry.After(refreshExpiry) {
		accessExpiry = refreshExpiry
	}
	if !refreshExpiry.After(now.Add(time.Second)) {
		return nil, "", time.Time{}, coreerrors.ErrUnauthorized
	}
	sign := func(purpose, jti string, expiry time.Time) (string, error) {
		claims := JWTClaims{Purpose: purpose, FamilyID: family, AuthVersion: authVersion, RegisteredClaims: jwt.RegisteredClaims{ID: jti, Issuer: s.cfg.JWT.Issuer, Subject: id.String(), IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expiry)}}
		return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWT.Secret))
	}
	access, err := sign("access", accessID, accessExpiry)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	refresh, err := sign("refresh", refreshID, refreshExpiry)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	return &domain.TokenPair{AccessToken: access, RefreshToken: refresh, ExpiresIn: int(time.Until(accessExpiry).Seconds())}, refreshID, refreshExpiry, nil
}
func secureToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
