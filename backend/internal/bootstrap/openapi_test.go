package bootstrap

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/config"
	"infranexus/internal/handler"
	"infranexus/internal/middleware"
)

// TestOpenAPICoversRoutes keeps the published specification aligned with registered APIs.
func TestOpenAPICoversRoutes(t *testing.T) {
	var spec struct {
		OpenAPI  string                                `json:"openapi"`
		Paths    map[string]map[string]json.RawMessage `json:"paths"`
		Security []map[string][]string                 `json:"security"`
	}
	if err := json.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(spec.OpenAPI, "3.") {
		t.Fatalf("expected OpenAPI 3.x, got %q", spec.OpenAPI)
	}
	if len(spec.Security) != 2 || len(spec.Security[0]) != 1 || len(spec.Security[1]) != 1 {
		t.Fatal("OpenAPI must declare Cookie and Bearer as alternative authentication methods")
	}
	if _, ok := spec.Security[0]["sessionCookie"]; !ok {
		t.Fatal("OpenAPI is missing the Cookie authentication requirement")
	}
	if _, ok := spec.Security[1]["bearerAuth"]; !ok {
		t.Fatal("OpenAPI is missing the Bearer authentication requirement")
	}
	app := fiber.New()
	registerRoutes(app, routeDeps{
		cfg: &config.Config{}, casbin: middleware.NewCasbin(middleware.CasbinConfig{}),
		health: &handler.HealthHandler{}, setup: &handler.SetupHandler{}, auth: &handler.AuthHandler{},
		users: &handler.UserHandler{}, roles: &handler.RoleHandler{}, permissions: &handler.PermissionHandler{},
		sse: &handler.SSEHandler{}, departments: &handler.DepartmentHandler{}, options: &handler.OptionsHandler{},
		ldap: &handler.LDAPHandler{}, dashboard: &handler.DashboardHandler{},
	})
	params := regexp.MustCompile(`:([A-Za-z0-9_]+)`)
	routes := make(map[string]bool)
	for _, route := range app.GetRoutes(true) {
		if !strings.HasPrefix(route.Path, "/api/v1/") {
			continue
		}
		switch route.Method {
		case "GET", "POST", "PUT", "PATCH", "DELETE":
		default:
			continue
		}
		path := params.ReplaceAllString(route.Path, `{$1}`)
		key := route.Method + " " + path
		routes[key] = true
		operation, ok := spec.Paths[path][strings.ToLower(route.Method)]
		if !ok {
			t.Errorf("route missing from OpenAPI: %s", key)
			continue
		}
		var doc struct {
			Security json.RawMessage `json:"security"`
		}
		if err := json.Unmarshal(operation, &doc); err != nil {
			t.Errorf("%s: %v", key, err)
			continue
		}
		_, public := publicRoutes[route.Method+" "+route.Path]
		if public && string(doc.Security) != "[]" {
			t.Errorf("public route %s must have security: []", key)
		}
		if !public && len(doc.Security) != 0 {
			t.Errorf("protected route %s must inherit the global authentication requirements", key)
		}
	}
	for path, methods := range spec.Paths {
		for method := range methods {
			key := strings.ToUpper(method) + " " + path
			if !routes[key] {
				t.Errorf("OpenAPI operation has no registered route: %s", key)
			}
		}
	}
}
