package bootstrap

import (
	"fmt"
	"log/slog"

	"github.com/casbin/casbin/v3"
	"github.com/casbin/casbin/v3/model"
	gormadapter "github.com/casbin/gorm-adapter/v3"
	"gorm.io/gorm"

	"infranexus/internal/middleware"
)

// InitCasbin 初始化 Casbin Enforcer 与 GORM 适配器
func InitCasbin(db *gorm.DB, log *slog.Logger) (*casbin.SyncedEnforcer, error) {
	adapter, err := gormadapter.NewAdapterByDB(db)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize casbin gorm adapter: %w", err)
	}

	m, err := model.NewModelFromString(middleware.RBACModel)
	if err != nil {
		return nil, fmt.Errorf("failed to parse casbin model: %w", err)
	}

	enforcer, err := casbin.NewSyncedEnforcer(m, adapter)
	if err != nil {
		return nil, fmt.Errorf("failed to create casbin enforcer: %w", err)
	}
	enforcer.EnableAutoSave(false)

	if err := enforcer.LoadPolicy(); err != nil {
		return nil, fmt.Errorf("failed to load casbin policy: %w", err)
	}

	log.Info("Casbin RBAC enforcer initialized successfully")
	return enforcer, nil
}
