package bootstrap

import (
	"context"
	"errors"
	"log/slog"
	"sync"

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

	closers    []func()
	background []func(ctx context.Context)
	stop       context.CancelFunc
	wg         sync.WaitGroup
}

func (a *AppContainer) OnClose(fn func()) {
	a.closers = append(a.closers, fn)
}

func (a *AppContainer) AddBackground(job func(ctx context.Context)) {
	a.background = append(a.background, job)
}

func (a *AppContainer) StartBackground() {
	ctx, cancel := context.WithCancel(context.Background())
	a.stop = cancel
	for _, job := range a.background {
		a.wg.Add(1)
		go func(run func(context.Context)) {
			defer a.wg.Done()
			run(ctx)
		}(job)
	}
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
	if a.stop != nil {
		a.stop()
		a.wg.Wait()
	}
	for i := len(a.closers) - 1; i >= 0; i-- {
		a.closers[i]()
	}
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
