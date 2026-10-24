package bootstrap

import (
	"fmt"
	"sort"
	"strings"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/config"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"infranexus/internal/handler"
	"infranexus/internal/middleware"
)

type routeDeps struct {
	health      *handler.HealthHandler
	cfg         *config.Config
	authSvc     domain.AuthService
	casbin      *middleware.Casbin
	auth        *handler.AuthHandler
	users       *handler.UserHandler
	roles       *handler.RoleHandler
	permissions *handler.PermissionHandler
	sse         *handler.SSEHandler
	departments *handler.DepartmentHandler
	options     *handler.OptionsHandler
	ldap        *handler.LDAPHandler
	dashboard   *handler.DashboardHandler
}

var publicRoutes = map[string]struct{}{
	"GET /api/v1/ready":         {},
	"GET /api/v1/health":        {},
	"POST /api/v1/auth/login":   {},
	"POST /api/v1/auth/token":   {},
	"POST /api/v1/auth/refresh": {},
	"GET /api/v1/auth/domains":  {},
}

var authenticatedRoutes = map[string]struct{}{
	"POST /api/v1/auth/logout":         {},
	"GET /api/v1/auth/me":              {},
	"PUT /api/v1/users/me/preferences": {},
	"GET /api/v1/options/roles":        {},
	"GET /api/v1/options/departments":  {},
	"GET /api/v1/sse/notifications":    {},
}

var rbacRouteRoots = []string{
	"/api/v1/dashboard",
	"/api/v1/users",
	"/api/v1/departments",
	"/api/v1/roles",
	"/api/v1/permissions",
	"/api/v1/ldap",
	"/api/v1/reports",
}

func discoverAPIRoutes(app *fiber.App) ([]domain.RouteInfo, error) {
	seen := make(map[string]bool)
	routes := make([]domain.RouteInfo, 0)
	for _, r := range app.GetRoutes(true) {
		switch r.Method {
		case fiber.MethodGet, fiber.MethodPost, fiber.MethodPut, fiber.MethodPatch, fiber.MethodDelete:
		default:
			continue
		}
		if !strings.HasPrefix(r.Path, "/api/v1/") {
			continue
		}
		key := r.Method + " " + r.Path
		if _, ok := publicRoutes[key]; ok {
			continue
		}
		if _, ok := authenticatedRoutes[key]; ok {
			continue
		}
		if !isRBACRoute(r.Path) {
			return nil, fmt.Errorf("API route has no declared access class: %s", key)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		routes = append(routes, domain.RouteInfo{Method: r.Method, Path: r.Path})
	}
	sort.Slice(routes, func(i, j int) bool {
		if routes[i].Path == routes[j].Path {
			return routes[i].Method < routes[j].Method
		}
		return routes[i].Path < routes[j].Path
	})
	return routes, nil
}

func isRBACRoute(path string) bool {
	for _, root := range rbacRouteRoots {
		if path == root || strings.HasPrefix(path, root+"/") {
			return true
		}
	}
	return false
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

	api.Get("/ready", d.health.Ready)

	authPublic := api.Group("/auth")
	authPublic.Post("/login", middleware.TrustedOrigin(d.cfg.Security.TrustedOrigins), middleware.LoginRateLimit(d.cfg.Security.LoginRateLimit), d.auth.Login)
	authPublic.Post("/token", middleware.LoginRateLimit(d.cfg.Security.LoginRateLimit), d.auth.Token)
	authPublic.Post("/refresh", d.auth.Refresh)
	authPublic.Get("/domains", d.auth.Domains)

	authRequired := api.Group("", middleware.DualAuth(d.authSvc, d.cfg))
	authRequired.Use(middleware.TrustedOrigin(d.cfg.Security.TrustedOrigins))
	authRequired.Post("/auth/logout", d.auth.Logout)
	authRequired.Get("/auth/me", d.auth.Me)
	authRequired.Put("/users/me/preferences", d.users.UpdateMyPreferences)
	authRequired.Get("/options/roles", d.options.Roles)
	authRequired.Get("/options/departments", d.options.Departments)
	authRequired.Get("/sse/notifications", d.casbin.RequiresPermissions([]string{"/api/v1/ldap/sync-logs:GET"}), d.sse.StreamNotifications)

	rbac := authRequired.Group("", d.casbin.RoutePermission())

	rbac.Get("/dashboard/overview", d.dashboard.Overview)

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
	users.Put("/:id/department", d.users.SetDepartment)

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
	roles.Get("/permission-tree", d.permissions.Tree)
	roles.Get("/:id", d.roles.GetByID)
	roles.Put("/:id", d.roles.Update)
	roles.Patch("/:id/status", d.roles.ToggleStatus)
	roles.Delete("/:id", d.roles.Delete)
	roles.Post("/:id/permissions", d.roles.AssignPermissions)

	permissions := rbac.Group("/permissions")
	permissions.Get("", d.permissions.Tree)
	permissions.Post("", d.permissions.Create)
	permissions.Post("/sync", d.permissions.Sync)
	permissions.Put("/:id", d.permissions.Update)
	permissions.Delete("/:id", d.permissions.Delete)

	ldap := rbac.Group("/ldap")
	ldap.Get("/configs", d.ldap.ListConfigs)
	ldap.Post("/configs", d.ldap.CreateConfig)
	ldap.Get("/configs/:id", d.ldap.GetConfig)
	ldap.Put("/configs/:id", d.ldap.UpdateConfig)
	ldap.Delete("/configs/:id", d.ldap.DeleteConfig)
	ldap.Post("/test", d.ldap.Test)
	ldap.Post("/preview", d.ldap.Preview)
	ldap.Post("/sync", d.ldap.Sync)
	ldap.Get("/sync-logs", d.ldap.SyncLogs)
	ldap.Get("/sync-logs/:id", d.ldap.SyncLog)
	ldap.Get("/sync-plans/:id/items", d.ldap.SyncPlanItems)
}
