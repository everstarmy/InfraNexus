package service

import (
	"context"

	"infranexus/internal/domain"
)

type permissionService struct {
	permRepo domain.PermissionRepository
}

func NewPermissionService(permRepo domain.PermissionRepository) domain.PermissionService {
	return &permissionService{permRepo: permRepo}
}

func (s *permissionService) Tree(ctx context.Context) ([]domain.Permission, error) {
	return s.permRepo.GetTree(ctx)
}
