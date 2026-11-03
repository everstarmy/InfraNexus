package service

import (
	"context"
	"time"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type healthService struct{ repo domain.HealthRepository }

func NewHealthService(repo domain.HealthRepository) domain.HealthService { return &healthService{repo} }
func (s *healthService) Ready(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err := s.repo.Check(ctx); err != nil {
		return coreerrors.NewDomainError(503, response.CodeNotReady, "服务暂未就绪", err)
	}
	return nil
}
