package bootstrap

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/config"
	"infranexus/internal/core/response"
)

func setupTestApp(t *testing.T) (*AppContainer, *fiber.App, func()) {
	tempDir, err := os.MkdirTemp("", "infranexus_api_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	dbPath := filepath.Join(tempDir, "api_test.db")
	cfg := &config.Config{
		App: config.AppConfig{
			Name:  "InfraNexus-Test",
			Env:   "test",
			Port:  "8080",
			Debug: false,
		},
		Database: config.DatabaseConfig{
			Driver: "sqlite",
			SQLite: config.SQLiteConfig{
				DBPath: dbPath,
			},
			Pool: config.PoolConfig{
				MaxIdleConns: 2,
				MaxOpenConns: 5,
			},
		},
		Session: config.SessionConfig{
			CookieName:     "infranexus_session",
			MaxAge:         86400,
			AbsoluteMaxAge: 604800,
			SameSite:       "Lax",
		},
		JWT: config.JWTConfig{
			Secret:             "test-jwt-secret-key-at-least-32-chars",
			AccessTokenExpire:  900,
			RefreshTokenExpire: 604800,
			Issuer:             "infranexus-test",
		},
		Security: config.SecurityConfig{TrustedOrigins: []string{"http://localhost:5173"}, LoginRateLimit: 10},
		Storage: config.StorageConfig{
			Driver: "memory",
		},
	}

	logger := slog.Default()
	container, err := NewAppContainer(cfg, logger)
	if err != nil {
		t.Fatalf("NewAppContainer failed: %v", err)
	}

	// 迁移数据库
	if err := Migrate(container.DB); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	if err := Seed(container.DB, logger); err != nil {
		t.Fatalf("Seed failed: %v", err)
	}

	fiberApp, err := NewFiberApp(container)
	if err != nil {
		t.Fatalf("NewFiberApp failed: %v", err)
	}

	cleanup := func() {
		container.Close()
		_ = os.RemoveAll(tempDir)
	}

	return container, fiberApp, cleanup
}

func TestE2E_FullAuthAndUserLifecycle(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()

	// 1. 测试健康检查
	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Health check request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}

	// 2. 测试登录 (默认种子管理员 admin / admin123456)
	loginBody, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "admin123456",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("Login request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("Expected login status 200, got %d: %s", resp.StatusCode, string(body))
	}

	var loginEnvelope response.Envelope[map[string]any]
	_ = json.NewDecoder(resp.Body).Decode(&loginEnvelope)

	if loginEnvelope.Code != response.CodeSuccess {
		t.Fatalf("Expected biz code 200000, got %v", loginEnvelope.Code)
	}

	if _, ok := loginEnvelope.Data["tokens"]; ok {
		t.Fatal("Web login leaked tokens")
	}
	if _, ok := loginEnvelope.Data["session_id"]; ok {
		t.Fatal("Web login leaked session ID")
	}
	if len(resp.Cookies()) == 0 || !resp.Cookies()[0].HttpOnly {
		t.Fatal("missing HttpOnly session cookie")
	}
	req = httptest.NewRequest("POST", "/api/v1/auth/token", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("token issue: %v / %d", err, resp.StatusCode)
	}
	var tokenEnvelope response.Envelope[map[string]any]
	if err := json.NewDecoder(resp.Body).Decode(&tokenEnvelope); err != nil {
		t.Fatal(err)
	}
	accessToken, _ := tokenEnvelope.Data["access_token"].(string)
	refreshToken, _ := tokenEnvelope.Data["refresh_token"].(string)
	if accessToken == "" || refreshToken == "" {
		t.Fatal("missing API token pair")
	}

	// 3. 测试受保护接口 /api/v1/auth/me (携带 Bearer Token)
	req = httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("Auth me request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected auth me status 200, got %d", resp.StatusCode)
	}

	// 4. 测试用户创建 (UUID 与参数校验)
	newUserBody, _ := json.Marshal(map[string]any{
		"username": "developer1",
		"email":    "dev1@infranexus.com",
		"password": "Password123!",
		"nickname": "开发工程师",
	})
	req = httptest.NewRequest("POST", "/api/v1/users", bytes.NewReader(newUserBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("Create user request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("Expected create user status 200, got %d: %s", resp.StatusCode, string(body))
	}

	var createUserEnvelope response.Envelope[map[string]any]
	_ = json.NewDecoder(resp.Body).Decode(&createUserEnvelope)
	createdUserIDStr, ok := createUserEnvelope.Data["id"].(string)
	if !ok || createdUserIDStr == "" {
		t.Fatalf("Expected created user ID to be non-empty UUID string")
	}
	createdUserID, err := uuid.Parse(createdUserIDStr)
	if err != nil || createdUserID == uuid.Nil {
		t.Fatalf("Expected valid UUID format, got %s: %v", createdUserIDStr, err)
	}

	// 5. 测试用户分页查询 /api/v1/users
	req = httptest.NewRequest("GET", "/api/v1/users?page=1&page_size=10&keyword=developer", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("List users request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected list users status 200, got %d", resp.StatusCode)
	}

	// 6. 测试 Token 刷新 /api/v1/auth/refresh
	refreshBody, _ := json.Marshal(map[string]string{
		"refresh_token": refreshToken,
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/refresh", bytes.NewReader(refreshBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("Refresh token request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected refresh status 200, got %d", resp.StatusCode)
	}

	// 7. 测试登出 /api/v1/auth/logout
	req = httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("Logout request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected logout status 200, got %d", resp.StatusCode)
	}
}
