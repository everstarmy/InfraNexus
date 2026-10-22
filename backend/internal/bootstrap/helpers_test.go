package bootstrap

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"

	"infranexus/internal/core/response"
	"infranexus/internal/service"
)

type apiResult struct {
	Status  int
	Code    response.BusinessCode
	Message string
	Data    json.RawMessage
}

func call(t *testing.T, app *fiber.App, method, path, bearer string, body any) apiResult {
	t.Helper()
	payload := ""
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		payload = string(raw)
	}
	res := doAuth(t, app, method, path, payload, "", bearer, nil)
	defer res.Body.Close()
	var env response.Envelope[json.RawMessage]
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		t.Fatalf("%s %s: decode envelope: %v", method, path, err)
	}
	return apiResult{Status: res.StatusCode, Code: env.Code, Message: env.Message, Data: env.Data}
}

func decode[T any](t *testing.T, raw json.RawMessage) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("decode %s: %v", string(raw), err)
	}
	return v
}

func tokenFor(t *testing.T, app *fiber.App, username, password string) string {
	t.Helper()
	r := call(t, app, "POST", "/api/v1/auth/token", "", map[string]string{"username": username, "password": password})
	if r.Status != 200 {
		t.Fatalf("token for %s: %d %s", username, r.Status, r.Message)
	}
	return "Bearer " + decode[map[string]any](t, r.Data)["access_token"].(string)
}

func adminToken(t *testing.T, app *fiber.App) string {
	t.Helper()
	return tokenFor(t, app, "admin", testAdminPassword)
}

func expectCode(t *testing.T, r apiResult, status int, code response.BusinessCode) {
	t.Helper()
	if r.Status != status || r.Code != code {
		t.Fatalf("want %d/%d, got %d/%d: %s", status, code, r.Status, r.Code, r.Message)
	}
}

func forgeIssuedAt(t *testing.T, container *AppContainer, bearer string, issuedAt time.Time) string {
	t.Helper()
	var claims service.JWTClaims
	raw := strings.TrimPrefix(bearer, "Bearer ")
	if _, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) { return []byte(container.Config.JWT.Secret), nil }); err != nil {
		t.Fatal(err)
	}
	claims.IssuedAt = jwt.NewNumericDate(issuedAt)
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(container.Config.JWT.Secret))
	if err != nil {
		t.Fatal(err)
	}
	return "Bearer " + signed
}
