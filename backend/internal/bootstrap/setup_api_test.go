package bootstrap

import (
	"encoding/json/v2"
	"io"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func TestSetupAPIInitializesAdministratorOnce(t *testing.T) {
	container, app, cleanup := setupTestAppWithAdmin(t, false)
	defer cleanup()
	status := call(t, app, "GET", "/api/v1/auth/setup", "", nil)
	expectCode(t, status, 200, response.CodeSuccess)
	if decode[domain.SetupStatus](t, status.Data).Initialized {
		t.Fatal("fresh database reported initialized")
	}

	// Initialization is public but still requires a trusted browser origin.
	untrusted := doAuth(t, app, "POST", "/api/v1/auth/setup", `{"password":"Setup!12345"}`, "https://untrusted.example", "", nil)
	if untrusted.StatusCode != 403 {
		t.Fatalf("untrusted setup status = %d", untrusted.StatusCode)
	}
	untrusted.Body.Close()
	missingOrigin := doAuth(t, app, "POST", "/api/v1/auth/setup", `{"password":"Setup!12345"}`, "", "", nil)
	if missingOrigin.StatusCode != 403 {
		t.Fatalf("missing-origin setup status = %d", missingOrigin.StatusCode)
	}
	missingOrigin.Body.Close()

	weak := doAuth(t, app, "POST", "/api/v1/auth/setup", `{"password":"weak"}`, "http://localhost:5173", "", nil)
	if weak.StatusCode != 400 {
		t.Fatalf("weak password setup status = %d", weak.StatusCode)
	}
	weak.Body.Close()
	created := doAuth(t, app, "POST", "/api/v1/auth/setup", `{"password":"Setup!12345"}`, "http://localhost:5173", "", nil)
	if created.StatusCode != 200 || created.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("setup status = %d", created.StatusCode)
	}
	var result response.Envelope[domain.SetupStatus]
	raw, err := io.ReadAll(created.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	created.Body.Close()
	if !result.Data.Initialized || result.RequestID == "" || result.Code != response.CodeSuccess {
		t.Fatal("invalid setup success envelope")
	}

	var admin domain.User
	if err := container.DB.Preload("Roles").First(&admin, "username = ?", "admin").Error; err != nil {
		t.Fatal(err)
	}
	if !admin.BuiltIn || len(admin.Roles) != 1 || admin.Roles[0].Code != domain.AdminRoleCode {
		t.Fatal("administrator privileges not assigned")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(admin.Password), []byte("Setup!12345")); err != nil {
		t.Fatal("administrator password was not hashed correctly")
	}
	// Freshly initialized administrator can log in and receive effective permissions.
	bearer := tokenFor(t, app, "admin", "Setup!12345")
	profile := call(t, app, "GET", "/api/v1/auth/me", bearer, nil)
	expectCode(t, profile, 200, response.CodeSuccess)
	if !decode[domain.CurrentUser](t, profile.Data).IsAdmin {
		t.Fatal("initialized administrator profile lacks administrator access")
	}
	repeated := doAuth(t, app, "POST", "/api/v1/auth/setup", `{"password":"Changed!12345"}`, "http://localhost:5173", "", nil)
	if repeated.StatusCode != 403 {
		t.Fatalf("repeated setup status = %d", repeated.StatusCode)
	}
	repeated.Body.Close()
	if !decode[domain.SetupStatus](t, call(t, app, "GET", "/api/v1/auth/setup", "", nil).Data).Initialized {
		t.Fatal("setup did not close")
	}

	// Losing role membership, disabling or soft-deleting the account must not
	// turn the public setup endpoint into an account recovery mechanism.
	if err := container.DB.Model(&admin).Association("Roles").Clear(); err != nil {
		t.Fatal(err)
	}
	if err := container.DB.Model(&admin).Update("status", domain.StatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	if err := container.DB.Delete(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if !decode[domain.SetupStatus](t, call(t, app, "GET", "/api/v1/auth/setup", "", nil).Data).Initialized {
		t.Fatal("setup reopened after administrator removal")
	}
}

func TestSetupStatusDatabaseFailureIsNotUninitialized(t *testing.T) {
	container, app, cleanup := setupTestAppWithAdmin(t, false)
	defer cleanup()
	db, err := container.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	status := call(t, app, "GET", "/api/v1/auth/setup", "", nil)
	if status.Status != 500 {
		t.Fatalf("database failure status = %d", status.Status)
	}
}
