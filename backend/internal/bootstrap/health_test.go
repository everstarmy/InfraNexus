package bootstrap

import (
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestReadinessTracksDependencies(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	check := func(path string, want int) {
		t.Helper()
		res, err := app.Test(httptest.NewRequest("GET", path, nil))
		if err != nil {
			t.Fatal(err)
		}
		envelope := readAuth(t, res)
		if res.StatusCode != want {
			t.Fatalf("%s status=%d code=%d", path, res.StatusCode, envelope.Code)
		}
	}
	check("/api/v1/ready", 200)
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	container.Redis = client
	app, err := NewFiberApp(container)
	if err != nil {
		t.Fatal(err)
	}
	check("/api/v1/ready", 200)
	server.Close()
	check("/api/v1/ready", 503)
	server.Restart()
	check("/api/v1/ready", 200)
	db, err := container.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	check("/api/v1/ready", 503)
	check("/api/v1/health", 200)
}
