package bootstrap

import (
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"infranexus/internal/config"
	"infranexus/internal/core/secret"
	"infranexus/internal/storage"
)

type AppContainer struct {
	Config  *config.Config
	Logger  *slog.Logger
	DB      *gorm.DB
	Redis   *redis.Client
	Storage fiber.Storage
	Cipher  *secret.Cipher
}

func NewCipher(cfg *config.Config, log *slog.Logger) (*secret.Cipher, error) {
	key := cfg.Security.EncryptionKey
	if key == "" || key == secret.DevKey {
		if cfg.App.Env == "production" {
			return nil, errors.New("security.encryption_key must be set to a non-default value in production")
		}
		key = secret.DevKey
		log.Warn("Using development encryption key for directory secrets; set security.encryption_key before production")
	}
	return secret.New(key)
}

func NewAppContainer(cfg *config.Config, log *slog.Logger) (*AppContainer, error) {
	cipher, err := NewCipher(cfg, log)
	if err != nil {
		return nil, err
	}

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
		Cipher:  cipher,
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
