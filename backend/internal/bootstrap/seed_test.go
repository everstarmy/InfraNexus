package bootstrap

import (
	"log/slog"
	"testing"

	"infranexus/internal/config"
	"infranexus/internal/core/secret"
	"infranexus/internal/domain"
)

func TestSeedIsIdempotentAndKeepsEditableFields(t *testing.T) {
	container, _, cleanup := setupTestApp(t)
	defer cleanup()
	db := container.DB
	var before int64
	db.Model(&domain.Permission{}).Count(&before)
	if before < 50 {
		t.Fatalf("expected full permission catalogue, got %d", before)
	}
	createUser := domain.APIPermissionCode("POST", "/api/v1/users")
	var api, button domain.Permission
	db.First(&api, "code = ?", createUser)
	db.First(&button, "code = ?", "users:create")
	if !api.BuiltIn || api.ParentID == nil || *api.ParentID != button.ID || api.Method != "POST" {
		t.Fatalf("api permission not attached under its button: %+v", api)
	}
	db.Model(&domain.Permission{}).Where("id = ?", button.ID).Updates(map[string]any{"name": "自定义名称", "type": "api"})
	db.Model(&domain.Permission{}).Where("id = ?", api.ID).Update("path", "/tampered")
	if err := Seed(db, slog.Default()); err != nil {
		t.Fatal(err)
	}
	var after int64
	db.Model(&domain.Permission{}).Count(&after)
	if after != before {
		t.Fatalf("reseed changed catalogue size: %d -> %d", before, after)
	}
	db.First(&button, "id = ?", button.ID)
	db.First(&api, "id = ?", api.ID)
	if button.Name != "自定义名称" || button.Type != domain.PermTypeButton || api.Path != "/api/v1/users" {
		t.Fatalf("reseed must keep names but restore locked fields: %+v / %+v", button, api)
	}
	var admins int64
	db.Model(&domain.User{}).Where("username = ? AND built_in = ?", "admin", true).Count(&admins)
	if admins != 1 {
		t.Fatalf("built-in admin count %d", admins)
	}
}

func TestProductionRequiresDedicatedEncryptionKey(t *testing.T) {
	for _, key := range []string{"", secret.DevKey} {
		cfg := &config.Config{App: config.AppConfig{Env: "production"}, Security: config.SecurityConfig{EncryptionKey: key}}
		if _, err := NewCipher(cfg, slog.Default()); err == nil {
			t.Fatalf("production accepted encryption key %q", key)
		}
	}
	cfg := &config.Config{App: config.AppConfig{Env: "production"}, Security: config.SecurityConfig{EncryptionKey: "a-real-production-key-123456"}}
	if _, err := NewCipher(cfg, slog.Default()); err != nil {
		t.Fatal(err)
	}
}
