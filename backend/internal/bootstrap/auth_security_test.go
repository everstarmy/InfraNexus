package bootstrap

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"infranexus/internal/service"
)

func doAuth(t *testing.T, app *fiber.App, method, path, body, origin, bearer string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	// Real password hashing under -race can exceed Fiber's one-second default on CI.
	res, err := app.Test(req, fiber.TestConfig{Timeout: 5 * time.Second, FailOnTimeout: true})
	if err != nil {
		t.Fatal(err)
	}
	return res
}
func readAuth(t *testing.T, res *http.Response) response.Envelope[map[string]json.RawMessage] {
	t.Helper()
	defer res.Body.Close()
	var v response.Envelope[map[string]json.RawMessage]
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if v.RequestID == "" {
		t.Fatal("missing request_id")
	}
	return v
}
func getString(t *testing.T, m map[string]json.RawMessage, key string) string {
	t.Helper()
	var v string
	if err := json.Unmarshal(m[key], &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func TestAuthSecurityContract(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	body := `{"username":"admin","password":"Admin!23456"}`
	origin := "http://localhost:5173"
	for _, bad := range []string{"", "https://evil.example"} {
		res := doAuth(t, app, "POST", "/api/v1/auth/login", body, bad, "", nil)
		if res.StatusCode != 403 {
			t.Fatalf("origin %q accepted: %d", bad, res.StatusCode)
		}
		readAuth(t, res)
	}
	res := doAuth(t, app, "POST", "/api/v1/auth/login", body, origin, "", nil)
	if res.StatusCode != 200 {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("login: %d %s", res.StatusCode, b)
	}
	data := readAuth(t, res).Data
	if _, ok := data["tokens"]; ok {
		t.Fatal("login leaked tokens")
	}
	if _, ok := data["session_id"]; ok {
		t.Fatal("login leaked session ID")
	}
	cookie := res.Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie attributes: %+v", cookie)
	}
	res = doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "", cookie)
	if res.StatusCode != 200 {
		t.Fatalf("cookie auth: %d", res.StatusCode)
	}
	readAuth(t, res)
	res = doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "Bearer invalid", cookie)
	if res.StatusCode != 401 {
		t.Fatalf("invalid Bearer fallback: %d", res.StatusCode)
	}
	readAuth(t, res)
	res = doAuth(t, app, "POST", "/api/v1/auth/token", body, "", "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("token issue: %d", res.StatusCode)
	}
	if len(res.Cookies()) != 0 {
		t.Fatal("token endpoint set cookie")
	}
	pair := readAuth(t, res).Data
	access := getString(t, pair, "access_token")
	refresh := getString(t, pair, "refresh_token")
	res = doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "Bearer "+refresh, nil)
	if res.StatusCode != 401 {
		t.Fatalf("refresh accepted as access: %d", res.StatusCode)
	}
	readAuth(t, res)
	payload, _ := json.Marshal(map[string]string{"refresh_token": access})
	res = doAuth(t, app, "POST", "/api/v1/auth/refresh", string(payload), "", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("access accepted as refresh: %d", res.StatusCode)
	}
	readAuth(t, res)
	payload, _ = json.Marshal(map[string]string{"refresh_token": refresh})
	var wg sync.WaitGroup
	type refreshResult struct {
		status int
		pair   map[string]json.RawMessage
	}
	statuses := make(chan refreshResult, 2)
	for range 2 {
		wg.Go(func() {
			r := doAuth(t, app, "POST", "/api/v1/auth/refresh", string(payload), "", "", nil)
			if r.StatusCode == 200 {
				statuses <- refreshResult{r.StatusCode, readAuth(t, r).Data}
			} else {
				statuses <- refreshResult{r.StatusCode, nil}
				_ = r.Body.Close()
			}
		})
	}
	wg.Wait()
	close(statuses)
	success, rejected := 0, 0
	var rotated map[string]json.RawMessage
	for result := range statuses {
		if result.status == 200 {
			rotated = result.pair
			success++
		} else if result.status == 401 {
			rejected++
		}
	}
	if success != 1 || rejected != 1 {
		t.Fatalf("refresh replay: success=%d rejected=%d", success, rejected)
	}
	rotatedAccess := getString(t, rotated, "access_token")
	rotatedRefresh := getString(t, rotated, "refresh_token")
	res = doAuth(t, app, "POST", "/api/v1/auth/logout", "", "", "Bearer "+rotatedAccess, nil)
	if res.StatusCode != 200 {
		t.Fatalf("logout: %d", res.StatusCode)
	}
	readAuth(t, res)
	res = doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "Bearer "+rotatedAccess, nil)
	if res.StatusCode != 401 {
		t.Fatalf("revoked access: %d", res.StatusCode)
	}
	readAuth(t, res)
	rotatedPayload, _ := json.Marshal(map[string]string{"refresh_token": rotatedRefresh})
	res = doAuth(t, app, "POST", "/api/v1/auth/refresh", string(rotatedPayload), "", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("revoked refresh: %d", res.StatusCode)
	}
	readAuth(t, res)
	// Role changes are read from the database rather than stale JWT claims.
	fresh := doAuth(t, app, "POST", "/api/v1/auth/token", body, "", "", nil)
	pair = readAuth(t, fresh).Data
	freshAccess := getString(t, pair, "access_token")
	var claims service.JWTClaims
	parsed, err := jwt.ParseWithClaims(freshAccess, &claims, func(*jwt.Token) (any, error) { return []byte(container.Config.JWT.Secret), nil })
	if err != nil || !parsed.Valid {
		t.Fatal(err)
	}
	forged := claims
	forged.Issuer = "wrong"
	wrongIssuer, err := jwt.NewWithClaims(jwt.SigningMethodHS256, forged).SignedString([]byte(container.Config.JWT.Secret))
	if err != nil {
		t.Fatal(err)
	}
	invalid := doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "Bearer "+wrongIssuer, nil)
	if invalid.StatusCode != 401 {
		t.Fatalf("wrong issuer: %d", invalid.StatusCode)
	}
	readAuth(t, invalid)
	forged = claims
	forged.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))
	expired, err := jwt.NewWithClaims(jwt.SigningMethodHS256, forged).SignedString([]byte(container.Config.JWT.Secret))
	if err != nil {
		t.Fatal(err)
	}
	invalid = doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "Bearer "+expired, nil)
	if invalid.StatusCode != 401 {
		t.Fatalf("expired token: %d", invalid.StatusCode)
	}
	readAuth(t, invalid)
	if err := container.DB.Model(&domain.Role{}).Where("code = ?", "admin").Update("code", "auditor").Error; err != nil {
		t.Fatal(err)
	}
	changed := doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "Bearer "+freshAccess, nil)
	if changed.StatusCode != 200 {
		t.Fatalf("role changed token rejected: %d", changed.StatusCode)
	}
	userData := readAuth(t, changed).Data
	if strings.Contains(string(userData["roles"]), `"code":"admin"`) {
		t.Fatal("stale admin role")
	}
	denied := doAuth(t, app, "GET", "/api/v1/users", "", "", "Bearer "+freshAccess, nil)
	if denied.StatusCode != 403 {
		t.Fatalf("stale admin authorization: %d", denied.StatusCode)
	}
	readAuth(t, denied)
	if err := container.DB.Model(&domain.User{}).Where("username = ?", "admin").Update("status", 2).Error; err != nil {
		t.Fatal(err)
	}
	disabled := doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "Bearer "+freshAccess, nil)
	if disabled.StatusCode != 401 {
		t.Fatalf("disabled user accepted: %d", disabled.StatusCode)
	}
	readAuth(t, disabled)
	if err := container.DB.Where("username = ?", "admin").Delete(&domain.User{}).Error; err != nil {
		t.Fatal(err)
	}
	missing := doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "", cookie)
	if missing.StatusCode != 401 {
		t.Fatalf("deleted user accepted: %d", missing.StatusCode)
	}
	readAuth(t, missing)
}

func TestAuthDatabaseFailureIsServerError(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	body := `{"username":"admin","password":"Admin!23456"}`
	origin := "http://localhost:5173"
	res := doAuth(t, app, "POST", "/api/v1/auth/login", body, origin, "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("setup login: %d", res.StatusCode)
	}
	cookie := res.Cookies()[0]
	readAuth(t, res)
	db, err := container.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	res = doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "", cookie)
	if res.StatusCode != 500 {
		t.Fatalf("database failure on me: %d", res.StatusCode)
	}
	readAuth(t, res)
	res = doAuth(t, app, "POST", "/api/v1/auth/login", body, origin, "", nil)
	if res.StatusCode != 500 {
		t.Fatalf("database failure on login: %d", res.StatusCode)
	}
	readAuth(t, res)
}

func TestSessionReplacementCSRFAndSecureCookie(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	body := `{"username":"admin","password":"Admin!23456"}`
	origin := "http://localhost:5173"
	first := doAuth(t, app, "POST", "/api/v1/auth/login", body, origin, "", nil)
	if first.StatusCode != 200 {
		t.Fatalf("first login: %d", first.StatusCode)
	}
	old := first.Cookies()[0]
	readAuth(t, first)
	bad := doAuth(t, app, "POST", "/api/v1/auth/logout", "", "https://evil.example", "", old)
	if bad.StatusCode != 403 {
		t.Fatalf("CSRF accepted: %d", bad.StatusCode)
	}
	readAuth(t, bad)
	bad = doAuth(t, app, "POST", "/api/v1/auth/logout", "", "", "", old)
	if bad.StatusCode != 403 {
		t.Fatalf("missing origin accepted: %d", bad.StatusCode)
	}
	readAuth(t, bad)
	second := doAuth(t, app, "POST", "/api/v1/auth/login", body, origin, "", old)
	if second.StatusCode != 200 {
		t.Fatalf("second login: %d", second.StatusCode)
	}
	fresh := second.Cookies()[0]
	readAuth(t, second)
	if fresh.Value == old.Value {
		t.Fatal("session reused")
	}
	invalid := doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "", old)
	if invalid.StatusCode != 401 {
		t.Fatalf("old session active: %d", invalid.StatusCode)
	}
	readAuth(t, invalid)
	valid := doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "", fresh)
	if valid.StatusCode != 200 {
		t.Fatalf("new session invalid: %d", valid.StatusCode)
	}
	if len(valid.Cookies()) == 0 || valid.Cookies()[0].Value != fresh.Value {
		t.Fatal("renewal did not update cookie")
	}
	readAuth(t, valid)
	container.Config.App.Env = "production"
	secure := doAuth(t, app, "POST", "/api/v1/auth/login", body, origin, "", fresh)
	if secure.StatusCode != 200 {
		t.Fatalf("production login: %d", secure.StatusCode)
	}
	if !secure.Cookies()[0].Secure {
		t.Fatal("production cookie not Secure")
	}
	readAuth(t, secure)
}
func TestLoginRateLimit(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	body := `{"username":"admin","password":"badpass"}`
	for i := range 11 {
		res := doAuth(t, app, "POST", "/api/v1/auth/token", body, "", "", nil)
		if i == 10 && res.StatusCode != 429 {
			t.Fatalf("rate limit: %d", res.StatusCode)
		}
		readAuth(t, res)
	}
}
