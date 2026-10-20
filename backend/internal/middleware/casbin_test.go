package middleware

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/casbin/casbin/v3"
	"github.com/casbin/casbin/v3/model"
	"github.com/gofiber/fiber/v3"

	coreerrors "infranexus/internal/core/errors"
)

func newTestEnforcer(t *testing.T, rules ...[]string) *casbin.SyncedEnforcer {
	t.Helper()
	m, err := model.NewModelFromString(RBACModel)
	if err != nil {
		t.Fatal(err)
	}
	e, err := casbin.NewSyncedEnforcer(m)
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) > 0 {
		if _, err := e.AddPolicies(rules); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func newAuthzApp(e *casbin.SyncedEnforcer, register func(app *fiber.App, m *Casbin)) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: coreerrors.GlobalErrorHandler})
	app.Use(func(c fiber.Ctx) error {
		if header := c.Get("X-Roles"); header != "" {
			roles := []string{}
			if header != "-" {
				roles = strings.Split(header, ",")
			}
			c.Locals("roles", roles)
		}
		return c.Next()
	})
	register(app, NewCasbin(CasbinConfig{Enforcer: e, SuperRole: "admin"}))
	return app
}

func status(t *testing.T, app *fiber.App, method, path, roles string) int {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if roles != "" {
		req.Header.Set("X-Roles", roles)
	}
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return res.StatusCode
}

func TestRoutePermissionUnionOfRolesAndSuperRole(t *testing.T) {
	e := newTestEnforcer(t,
		[]string{"viewer", "/api/v1/users", "GET"},
		[]string{"editor", "/api/v1/users", "POST"},
		[]string{"editor", "/api/v1/users/:id", "PUT"},
	)
	app := newAuthzApp(e, func(app *fiber.App, m *Casbin) {
		ok := func(c fiber.Ctx) error { return c.SendStatus(200) }
		g := app.Group("/api/v1", m.RoutePermission())
		g.Get("/users", ok)
		g.Post("/users", ok)
		g.Put("/users/:id", ok)
		g.Delete("/users/:id", ok)
	})
	cases := []struct {
		method, path, roles string
		want                int
	}{
		{"GET", "/api/v1/users", "viewer", 200},
		{"POST", "/api/v1/users", "viewer", 403},
		{"POST", "/api/v1/users", "viewer,editor", 200},
		{"PUT", "/api/v1/users/42", "editor", 200},
		{"DELETE", "/api/v1/users/42", "viewer,editor", 403},
		{"DELETE", "/api/v1/users/42", "auditor,admin", 200},
		{"GET", "/api/v1/users", "-", 403},
		{"GET", "/api/v1/users", "", 401},
	}
	for _, tc := range cases {
		if got := status(t, app, tc.method, tc.path, tc.roles); got != tc.want {
			t.Fatalf("%s %s as [%s]: got %d want %d", tc.method, tc.path, tc.roles, got, tc.want)
		}
	}
}

func TestRequiresPermissionsChecksExplicitObjectsAndActions(t *testing.T) {
	e := newTestEnforcer(t, []string{"auditor", "/reports/:id", "GET"})
	app := newAuthzApp(e, func(app *fiber.App, m *Casbin) {
		ok := func(c fiber.Ctx) error { return c.SendStatus(200) }
		app.Post("/export", m.RequiresPermissions([]string{"/reports/:id:GET"}), ok)
		app.Post("/purge", m.RequiresPermissions([]string{"/reports/:id:GET", "/reports/:id:DELETE"}), ok)
	})
	if got := status(t, app, "POST", "/export", "auditor"); got != 200 {
		t.Fatalf("export: %d", got)
	}
	if got := status(t, app, "POST", "/purge", "auditor"); got != 403 {
		t.Fatalf("purge must require every listed permission: %d", got)
	}
}
