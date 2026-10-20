package bootstrap

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"gorm.io/datatypes"

	"infranexus/internal/config"
	"infranexus/internal/domain"
)

func TestInitDatabase_SQLite_And_UUID(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "infranexus_db_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	dbPath := filepath.Join(tempDir, "test.db")
	cfg := &config.Config{
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
	}

	logger := slog.Default()
	db, err := InitDatabase(cfg, logger)
	if err != nil {
		t.Fatalf("InitDatabase failed: %v", err)
	}

	// 自动迁移
	err = db.AutoMigrate(&domain.User{}, &domain.Role{}, &domain.Permission{})
	if err != nil {
		t.Fatalf("AutoMigrate failed: %v", err)
	}

	// 测试创建用户与 UUID 自动发号
	user := domain.User{
		Username: "admin",
		Email:    "admin@infranexus.com",
		Password: "hashedpassword123",
		Nickname: "超级管理员",
		Preferences: datatypes.NewJSONType(domain.UserPreferences{
			Theme:        "dark",
			Locale:       "zh-CN",
			PinnedRoutes: []string{"/dashboard", "/users"},
		}),
	}

	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("Create user failed: %v", err)
	}

	if user.ID == uuid.Nil {
		t.Fatalf("Expected user.ID to be populated with valid UUID, got nil")
	}

	// 查询验证
	var queryUser domain.User
	if err := db.First(&queryUser, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("Query user by UUID failed: %v", err)
	}

	if queryUser.Username != "admin" {
		t.Errorf("Expected username admin, got %s", queryUser.Username)
	}

	if queryUser.Preferences.Data().Theme != "dark" {
		t.Errorf("Expected theme dark, got %s", queryUser.Preferences.Data().Theme)
	}

	if len(queryUser.Preferences.Data().PinnedRoutes) != 2 {
		t.Errorf("Expected 2 pinned routes, got %d", len(queryUser.Preferences.Data().PinnedRoutes))
	}
}
