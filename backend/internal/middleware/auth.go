package middleware

import (
	"errors"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/config"
	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type UserContext struct {
	UserID   uuid.UUID `json:"user_id"`
	Username string    `json:"username"`
	Roles    []string  `json:"roles"`
}

func DualAuth(authSvc domain.AuthService, cfg *config.Config) fiber.Handler {
	return func(c fiber.Ctx) error {
		var p *domain.Principal
		var expiry time.Time
		var err error
		// Presence of any Authorization header disables Cookie fallback.
		header := c.Get("Authorization")
		if header != "" {
			parts := strings.Fields(header)
			if len(parts) != 2 || parts[0] != "Bearer" {
				return coreerrors.ErrUnauthorized
			}
			p, err = authSvc.AuthenticateBearer(c.Context(), parts[1])
		} else {
			cookie := c.Cookies(cfg.Session.CookieName)
			p, expiry, err = authSvc.AuthenticateSession(c.Context(), cookie)
			if err == nil {
				SetSessionCookie(c, cfg, p.SessionID, expiry)
			} else if cookie != "" && (errors.Is(err, coreerrors.ErrUnauthorized) || errors.Is(err, coreerrors.ErrSessionRevoked)) {
				ClearSessionCookie(c, cfg)
			}
		}
		if err != nil {
			return err
		}
		c.Locals("current_principal", p)
		c.Locals("current_user", &UserContext{UserID: p.UserID, Username: p.Username, Roles: p.Roles})
		c.Locals("user_id", p.UserID)
		c.Locals("roles", p.Roles)
		return c.Next()
	}
}
func SetSessionCookie(c fiber.Ctx, cfg *config.Config, id string, expiry time.Time) {
	age := int(time.Until(expiry).Seconds())
	if age < 1 {
		age = 1
	}
	c.Cookie(&fiber.Cookie{Name: cfg.Session.CookieName, Value: id, MaxAge: age, Expires: expiry, Path: "/", Domain: cfg.Session.Domain, Secure: cfg.Session.Secure || cfg.App.Env == "production", HTTPOnly: true, SameSite: "Lax"})
}
func ClearSessionCookie(c fiber.Ctx, cfg *config.Config) {
	c.Cookie(&fiber.Cookie{Name: cfg.Session.CookieName, Value: "", MaxAge: -1, Expires: time.Unix(0, 0), Path: "/", Domain: cfg.Session.Domain, Secure: cfg.Session.Secure || cfg.App.Env == "production", HTTPOnly: true, SameSite: "Lax"})
}
