package bootstrap

import (
	"context"
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
		return startupFailure("jwt", "jwt_secret_invalid", "APP_JWT_SECRET must be a non-default secret with at least 32 bytes in production", nil)
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
			return nil, startupFailure("encryption", "encryption_key_missing_or_default", "APP_SECURITY_ENCRYPTION_KEY must be set to a non-default value in production", nil)
		}
		key = secret.DevKey
		log.Warn("Using development encryption key for directory secrets; set security.encryption_key before production")
	}
	cipher, err := secret.New(key)
	if err != nil {
		return nil, startupFailure("encryption", "encryption_key_too_short", "APP_SECURITY_ENCRYPTION_KEY must be at least 16 bytes", err)
	}
	return cipher, nil
}

func NewAppContainer(cfg *config.Config, log *slog.Logger) (*AppContainer, error) {
	if err := cfg.ValidateRuntime(); err != nil {
		return nil, startupFailure("configuration", "runtime_config_invalid", "Check application environment and trusted proxy configuration", err)
	}
	if err := validateSecurityConfig(cfg); err != nil {
		return nil, err
	}
	cipher, err := NewCipher(cfg, log)
	if err != nil {
		return nil, err
	}

	container := &AppContainer{Config: cfg, Logger: log, Cipher: cipher}
	ready := false
	defer func() {
		if !ready {
			container.Close()
		}
	}()

	db, err := InitDatabase(cfg, log)
	if err != nil {
		return nil, startupFailure("database", "database_initialization_failed", "Check database configuration, credentials and connectivity", err)
	}

	container.DB = db
	rdb, err := InitRedis(cfg, log)
	if err != nil {
		return nil, startupFailure("redis", "redis_initialization_failed", "Check Redis configuration and connectivity", err)
	}

	container.Redis = rdb
	store, err := storage.NewStorage(cfg)
	if err != nil {
		return nil, startupFailure("storage", "storage_initialization_failed", "Check storage driver configuration and access", err)
	}

	container.Storage = store
	container.lifecycle, container.stop = context.WithCancel(context.Background())
	ready = true
	return container, nil
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
