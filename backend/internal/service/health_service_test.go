package service

import (
	"context"
	"testing"
	"time"

	coreerrors "infranexus/internal/core/errors"
)

type stalledHealthRepository struct{}

func (stalledHealthRepository) Check(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }

func TestReadinessTimeoutAndSafeError(t *testing.T) {
	start := time.Now()
	err := NewHealthService(stalledHealthRepository{}).Ready(t.Context())
	classified := coreerrors.Classify(err)
	if classified.HTTPStatus != 503 || classified.BizCode != 503002 {
		t.Fatalf("unexpected classification: %+v", classified)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("readiness exceeded timeout budget")
	}
}
