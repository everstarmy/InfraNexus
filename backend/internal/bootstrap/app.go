package bootstrap

import (
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"infranexus/internal/config"
	"infranexus/internal/storage"
)

type AppContainer struct {
	Config  *config.Config
	Logger  *slog.Logger
	DB      *gorm.DB
	Redis   *redis.Client
	Storage fiber.Storage
}

func NewAppContainer(cfg *config.Config, log *slog.Logger) (*AppContainer, error) {
	db, err := InitDatabase(cfg, log)
	if err != nil {
		return nil, err
	}

	rdb, err := InitRedis(cfg, log)
	if err != nil {
		return nil, err
	}

	store, err := storage.NewStorage(cfg)
	if err != nil {
		return nil, err
	}

	return &AppContainer{
		Config:  cfg,
		Logger:  log,
		DB:      db,
		Redis:   rdb,
		Storage: store,
	}, nil
}

func (a *AppContainer) Close() {
	if a.DB != nil {
		if sqlDB, err := a.DB.DB(); err == nil {
			_ = sqlDB.Close()
		}
	}
	if a.Redis != nil {
		_ = a.Redis.Close()
	}
	if a.Storage != nil {
		_ = a.Storage.Close()
	}
}
