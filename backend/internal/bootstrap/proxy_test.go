package bootstrap

import (
	"net/http/httptest"
	"testing"
)

func TestProxyLoginRateLimitIsolation(t *testing.T) {
	for _, trusted := range []bool{false, true} {
		t.Run(map[bool]string{false: "untrusted", true: "trusted"}[trusted], func(t *testing.T) {
			container, _, cleanup := setupTestApp(t)
			defer cleanup()
			container.Config.Security.LoginRateLimit = 1
			if trusted {
				container.Config.Security.TrustedProxies = []string{"0.0.0.0"}
			}
			app, err := NewFiberApp(container)
			if err != nil {
				t.Fatal(err)
			}
			for i, ip := range []string{"192.0.2.1", "192.0.2.2", "192.0.2.2"} {
				req := httptest.NewRequest("POST", "/api/v1/auth/token", nil)
				req.Header.Set("X-Real-IP", ip)
				res, err := app.Test(req)
				if err != nil {
					t.Fatal(err)
				}
				res.Body.Close()
				limited := i == 2 || (!trusted && i > 0)
				if (res.StatusCode == 429) != limited {
					t.Fatalf("request %d trusted=%v status=%d", i, trusted, res.StatusCode)
				}
			}
		})
	}
}
