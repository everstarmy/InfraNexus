package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/redis/go-redis/v9"
	"infranexus/internal/domain"
)

type healthRepository struct {
	db           *sql.DB
	redis        *redis.Client
	requireRedis bool
}

func NewHealthRepository(db *sql.DB, redis *redis.Client, requireRedis bool) domain.HealthRepository {
	return &healthRepository{db, redis, requireRedis}
}
func (r *healthRepository) Check(ctx context.Context) error {
	if err := r.db.PingContext(ctx); err != nil {
		return err
	}
	if r.redis != nil {
		return r.redis.Ping(ctx).Err()
	}
	if r.requireRedis {
		return errors.New("required authentication store unavailable")
	}
	return nil
}
