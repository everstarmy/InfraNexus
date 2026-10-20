package bootstrap

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"infranexus/internal/config"
)

func InitRedis(cfg *config.Config, log *slog.Logger) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
		PoolSize: cfg.Redis.PoolSize,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		if cfg.App.Env == "production" {
			_ = rdb.Close()
			return nil, fmt.Errorf("redis unavailable in production: %w", err)
		}
		log.Warn("Redis ping connection failed (offline mode fallback)", "addr", fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port), "error", err)
		_ = rdb.Close()
		return nil, nil
	}

	log.Info("Redis client connected successfully", "addr", fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port), "db", cfg.Redis.DB)
	return rdb, nil
}
