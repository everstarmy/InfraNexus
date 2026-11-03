package middleware

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/casbin/casbin/v3"
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/errors"
)

const RBACModel = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && keyMatch2(r.obj, p.obj) && (r.act == p.act || p.act == "*")
`

type CasbinConfig struct {
	Enforcer     *casbin.SyncedEnforcer
	Authorize    func(context.Context, string, string, string) (bool, error)
	Lookup       func(c fiber.Ctx) []string
	SuperRole    string
	Unauthorized fiber.Handler
	Forbidden    fiber.Handler
}

type Casbin struct {
	config CasbinConfig
}

type permissionTarget struct {
	object string
	action string
}

func NewCasbin(cfg CasbinConfig) *Casbin {
	if cfg.Lookup == nil {
		cfg.Lookup = func(c fiber.Ctx) []string {
			roles, ok := c.Locals("roles").([]string)
			if !ok {
				return nil
			}
			if roles == nil {
				return []string{}
			}
			return roles
		}
	}
	if cfg.Unauthorized == nil {
		cfg.Unauthorized = func(c fiber.Ctx) error { return errors.ErrUnauthorized }
	}
	if cfg.Forbidden == nil {
		cfg.Forbidden = func(c fiber.Ctx) error { return errors.ErrPermissionDenied }
	}
	return &Casbin{config: cfg}
}

func (m *Casbin) RoutePermission() fiber.Handler {
	return m.require(func(c fiber.Ctx) []permissionTarget {
		return []permissionTarget{{object: c.Path(), action: c.Method()}}
	})
}

func (m *Casbin) RequiresPermissions(permissions []string) fiber.Handler {
	targets := make([]permissionTarget, 0, len(permissions))
	for _, p := range permissions {
		i := strings.LastIndex(p, ":")
		if i <= 0 || i == len(p)-1 {
			panic(fmt.Sprintf("casbin: invalid permission %q, expected object:action", p))
		}
		targets = append(targets, permissionTarget{object: p[:i], action: p[i+1:]})
	}
	return m.require(func(fiber.Ctx) []permissionTarget { return targets })
}

func (m *Casbin) require(targets func(c fiber.Ctx) []permissionTarget) fiber.Handler {
	return func(c fiber.Ctx) error {
		subjects := m.config.Lookup(c)
		if subjects == nil {
			return m.config.Unauthorized(c)
		}
		if (m.config.Enforcer == nil && m.config.Authorize == nil) || len(subjects) == 0 {
			return m.config.Forbidden(c)
		}
		if m.config.SuperRole != "" && slices.Contains(subjects, m.config.SuperRole) {
			return c.Next()
		}
		for _, target := range targets(c) {
			allowed, err := m.anyAllows(c.Context(), subjects, target)
			if err != nil {
				return err
			}
			if !allowed {
				return m.config.Forbidden(c)
			}
		}
		return c.Next()
	}
}

func (m *Casbin) anyAllows(ctx context.Context, subjects []string, target permissionTarget) (bool, error) {
	for _, sub := range subjects {
		var (
			ok  bool
			err error
		)
		if m.config.Authorize != nil {
			ok, err = m.config.Authorize(ctx, sub, target.object, target.action)
		} else {
			ok, err = m.config.Enforcer.Enforce(sub, target.object, target.action)
		}
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}
