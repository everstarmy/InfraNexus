package bootstrap

import (
	"context"
	"errors"
	"fmt"
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
	lifecycle  context.Context
	stop       context.CancelFunc
	wg         sync.WaitGroup
}

const defaultJWTSecret = "infranexus-super-secret-jwt-key-32chars!"

func validateSecurityConfig(cfg *config.Config) error {
	if cfg.App.Env != "production" {
		return nil
	}
	if len(cfg.JWT.Secret) < 32 || cfg.JWT.Secret == defaultJWTSecret {
		return fmt.Errorf("jwt.secret must be a unique secret with at least 32 characters in production")
	}
	return nil
}

func (a *AppContainer) OnClose(fn func()) {
	a.closers = append(a.closers, fn)
}

func (a *AppContainer) AddBackground(job func(ctx context.Context)) {
	a.background = append(a.background, job)
}

func (a *AppContainer) StartBackground() {
	if a.lifecycle == nil {
		a.lifecycle, a.stop = context.WithCancel(context.Background())
	}
	for _, job := range a.background {
		a.wg.Add(1)
		go func(run func(context.Context)) {
			defer a.wg.Done()
			run(a.lifecycle)
		}(job)
	}
}

func (a *AppContainer) lifecycleContext() context.Context {
	if a.lifecycle == nil {
		return context.Background()
	}
	return a.lifecycle
}

func (a *AppContainer) cancelLifecycle() {
	if a.stop != nil {
		a.stop()
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
	if err := validateSecurityConfig(cfg); err != nil {
		return nil, err
	}
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

	lifecycle, stop := context.WithCancel(context.Background())
	return &AppContainer{
		Config:  cfg,
		Logger:  log,
		DB:      db,
		Redis:   rdb,
		Storage: store,
		Cipher:  cipher,
		lifecycle: lifecycle,
		stop:      stop,
	}, nil
}

func (a *AppContainer) Close() {
	a.cancelLifecycle()
	if a.stop != nil {
		a.wg.Wait()
	}
	for i := len(a.closers) - 1; i >= 0; i-- {
		a.closers[i]()
	}
	if a.DB != nil {
		if sqlDB, err := a.DB.DB(); err != nil {
			a.logCloseError("database handle", err)
		} else if err := sqlDB.Close(); err != nil {
			a.logCloseError("database", err)
		}
	}
	if a.Redis != nil {
		if err := a.Redis.Close(); err != nil {
			a.logCloseError("redis", err)
		}
	}
	if a.Storage != nil {
		if err := a.Storage.Close(); err != nil {
			a.logCloseError("storage", err)
		}
	}
}

func (a *AppContainer) logCloseError(resource string, err error) {
	if a.Logger != nil {
		a.Logger.Error("Close application resource failed", "resource", resource, "error_type", fmt.Sprintf("%T", err))
	}
}
