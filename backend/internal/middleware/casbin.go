package middleware

import (
	"github.com/casbin/casbin/v3"
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/errors"
)

// CasbinRBAC 细粒度角色权限校验拦截器
func CasbinRBAC(enforcer *casbin.Enforcer) fiber.Handler {
	return func(c fiber.Ctx) error {
		if enforcer == nil {
			return errors.ErrPermissionDenied
		}

		roles, ok := c.Locals("roles").([]string)
		if !ok || len(roles) == 0 {
			return errors.ErrPermissionDenied
		}

		path := c.Path()
		method := c.Method()

		for _, role := range roles {
			// 超级管理员直接放行
			if role == "admin" {
				return c.Next()
			}

			allowed, err := enforcer.Enforce(role, path, method)
			if err == nil && allowed {
				return c.Next()
			}
		}

		return errors.ErrPermissionDenied
	}
}
