package service

import (
	"context"
	"log/slog"
	"time"

	"infranexus/internal/config"
	"infranexus/internal/core/logger"
	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
)

// RunRetention bounds each batch and waits for cancellation between runs.
func RunRetention(ctx context.Context, repo domain.RetentionRepository, cfg config.RetentionConfig, log *slog.Logger) {
	ctx = requestmeta.WithTask(ctx, "retention", "")
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		now := time.Now()
		batch, cancel := context.WithTimeout(ctx, 10*time.Second)
		count, err := repo.Cleanup(batch, now.AddDate(0, 0, -cfg.OutboxDays), now.AddDate(0, 0, -cfg.SyncLogDays), 100)
		cancel()
		if err != nil && ctx.Err() == nil {
			log.WarnContext(ctx, "Retention cleanup failed", append([]any{"component", "retention_service", "event", "retention.cleanup_failed"}, logger.SafeError(err)...)...)
		} else if count > 0 {
			log.InfoContext(ctx, "Expired records removed", "component", "retention_service", "event", "retention.cleaned", "rows", count)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
