package storage

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/storage/memory/v2"
	"github.com/gofiber/storage/postgres/v3"
	"github.com/gofiber/storage/redis/v3"
	"github.com/gofiber/storage/s3/v2"

	"infranexus/internal/config"
)

// NewStorage 统一 Fiber Storage 抽象工厂
func NewStorage(cfg *config.Config) (fiber.Storage, error) {
	switch cfg.Storage.Driver {
	case "memory":
		return memory.New(memory.Config{
			GCInterval: 10 * time.Minute,
		}), nil

	case "redis":
		return redis.New(redis.Config{
			Host:     cfg.Redis.Host,
			Port:     cfg.Redis.Port,
			Password: cfg.Redis.Password,
			Database: cfg.Redis.DB,
			Reset:    false,
		}), nil

	case "postgres":
		return postgres.New(postgres.Config{
			ConnectionURI: cfg.Database.DSN,
			Host:          cfg.Database.Host,
			Port:          cfg.Database.Port,
			Username:      cfg.Database.User,
			Password:      cfg.Database.Password,
			Database:      cfg.Database.DBName,
			SSLMode:       cfg.Database.SSLMode,
			Table:         "fiber_storage",
			Reset:         false,
		}), nil

	case "s3":
		cfgS3 := s3.Config{
			Bucket:   cfg.Storage.S3.Bucket,
			Endpoint: cfg.Storage.S3.Endpoint,
			Region:   cfg.Storage.S3.Region,
			Reset:    false,
		}
		if cfg.Storage.S3.AccessKey != "" || cfg.Storage.S3.SecretKey != "" {
			cfgS3.Credentials = s3.Credentials{
				AccessKey:       cfg.Storage.S3.AccessKey,
				SecretAccessKey: cfg.Storage.S3.SecretKey,
			}
		}
		return s3.New(cfgS3), nil

	case "":
		return memory.New(), nil
	default:
		return nil, fmt.Errorf("unsupported storage driver: %s", cfg.Storage.Driver)
	}
}
