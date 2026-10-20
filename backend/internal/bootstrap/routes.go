package bootstrap

import (
	"github.com/casbin/casbin/v3"
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/config"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"infranexus/internal/handler"
	"infranexus/internal/middleware"
)

type routeDeps struct {
	cfg         *config.Config
	authSvc     domain.AuthService
	enforcer    *casbin.Enforcer
	auth        *handler.AuthHandler
	users       *handler.UserHandler
	roles       *handler.RoleHandler
	departments *handler.DepartmentHandler
	options     *handler.OptionsHandler
}

func registerRoutes(app *fiber.App, d routeDeps) {
	api := app.Group("/api/v1")

	api.Get("/health", func(c fiber.Ctx) error {
		return response.Success(c, fiber.Map{
			"status":  "ok",
			"app":     d.cfg.App.Name,
			"env":     d.cfg.App.Env,
			"storage": d.cfg.Storage.Driver,
		})
	})

	authPublic := api.Group("/auth")
	authPublic.Post("/login", middleware.TrustedOrigin(d.cfg.Security.TrustedOrigins), middleware.LoginRateLimit(d.cfg.Security.LoginRateLimit), d.auth.Login)
	authPublic.Post("/token", middleware.LoginRateLimit(d.cfg.Security.LoginRateLimit), d.auth.Token)
	authPublic.Post("/refresh", d.auth.Refresh)

	authRequired := api.Group("", middleware.DualAuth(d.authSvc, d.cfg))
	authRequired.Use(middleware.TrustedOrigin(d.cfg.Security.TrustedOrigins))
	authRequired.Post("/auth/logout", d.auth.Logout)
	authRequired.Get("/auth/me", d.auth.Me)
	authRequired.Put("/users/me/preferences", d.users.UpdateMyPreferences)
	authRequired.Get("/options/roles", d.options.Roles)
	authRequired.Get("/options/departments", d.options.Departments)
	authRequired.Get("/sse/notifications", handler.StreamNotifications)

	rbac := authRequired.Group("", middleware.CasbinRBAC(d.enforcer))

	users := rbac.Group("/users")
	users.Get("", d.users.List)
	users.Post("", d.users.Create)
	users.Get("/stats", d.users.Stats)
	users.Post("/batch-move-department", d.users.BatchMoveDepartment)
	users.Get("/:id", d.users.GetByID)
	users.Put("/:id", d.users.Update)
	users.Delete("/:id", d.users.Delete)
	users.Patch("/:id/status", d.users.ToggleStatus)
	users.Post("/:id/reset-password", d.users.ResetPassword)
	users.Put("/:id/roles", d.users.AssignRoles)

	departments := rbac.Group("/departments")
	departments.Get("/tree", d.departments.Tree)
	departments.Put("/reorder", d.departments.Reorder)
	departments.Post("", d.departments.Create)
	departments.Get("/:id", d.departments.GetByID)
	departments.Put("/:id", d.departments.Update)
	departments.Delete("/:id", d.departments.Delete)
	departments.Post("/:id/move", d.departments.Move)

	roles := rbac.Group("/roles")
	roles.Get("", d.roles.List)
	roles.Post("", d.roles.Create)
	roles.Get("/:id", d.roles.GetByID)
	roles.Put("/:id", d.roles.Update)
	roles.Delete("/:id", d.roles.Delete)
	roles.Post("/:id/permissions", d.roles.AssignPermissions)

	rbac.Get("/permissions", d.roles.GetPermissionTree)
}
