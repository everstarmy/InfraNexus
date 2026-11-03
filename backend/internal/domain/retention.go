package domain

import (
	"context"
	"time"
)

type RetentionRepository interface {
	Cleanup(ctx context.Context, outboxBefore, logsBefore time.Time, limit int) (int64, error)
}
