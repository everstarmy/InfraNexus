package bootstrap

import (
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestDiscoverAPIRoutesRequiresExplicitAccessClass(t *testing.T) {
	app := fiber.New()
	app.Get("/api/v1/health", emptyRoute)
	app.Post("/api/v1/auth/login", emptyRoute)
	app.Get("/api/v1/options/roles", emptyRoute)
	app.Get("/api/v1/users/:id", emptyRoute)
	app.Get("/api/v1/unclassified/report", emptyRoute)

	if _, err := discoverAPIRoutes(app); err == nil {
		t.Fatal("unclassified API route was silently accepted")
	}
	app = fiber.New()
	app.Get("/api/v1/health", emptyRoute)
	app.Post("/api/v1/auth/login", emptyRoute)
	app.Get("/api/v1/options/roles", emptyRoute)
	app.Get("/api/v1/users/:id", emptyRoute)
	routes, err := discoverAPIRoutes(app)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 1 || routes[0].Method != fiber.MethodGet || routes[0].Path != "/api/v1/users/:id" {
		t.Fatalf("RBAC route catalog = %+v", routes)
	}
}

func emptyRoute(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) }
