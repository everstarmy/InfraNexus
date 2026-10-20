package service

import (
	"context"

	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type roleService struct {
	roleRepo domain.RoleRepository
	authz    domain.AuthorizationService
}

func NewRoleService(roleRepo domain.RoleRepository, authz domain.AuthorizationService) domain.RoleService {
	return &roleService{
		roleRepo: roleRepo,
		authz:    authz,
	}
}

func (s *roleService) ListRoles(ctx context.Context, keyword string, page, pageSize int) ([]domain.Role, int64, error) {
	return s.roleRepo.Search(ctx, keyword, page, pageSize)
}

func (s *roleService) Options(ctx context.Context) ([]domain.Role, error) {
	return s.roleRepo.ListAll(ctx)
}

func (s *roleService) GetRole(ctx context.Context, id uuid.UUID) (*domain.Role, error) {
	role, err := s.roleRepo.GetByID(ctx, id)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrRoleNotFound)
	}
	return role, nil
}

func (s *roleService) CreateRole(ctx context.Context, req domain.CreateRoleRequest) (*domain.Role, error) {
	if existing, _ := s.roleRepo.GetByCode(ctx, req.Code); existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("角色代码已存在")
	}
	role := domain.Role{
		Code:        req.Code,
		Name:        req.Name,
		Description: req.Description,
		Status:      domain.StatusEnabled,
	}
	if err := s.roleRepo.Create(ctx, &role); err != nil {
		return nil, err
	}
	return &role, nil
}

func (s *roleService) UpdateRole(ctx context.Context, id uuid.UUID, req domain.UpdateRoleRequest) (*domain.Role, error) {
	role, err := s.GetRole(ctx, id)
	if err != nil {
		return nil, err
	}
	values := map[string]any{}
	if req.Status != nil {
		if role.BuiltIn && *req.Status != domain.StatusEnabled {
			return nil, coreerrors.ErrBuiltinProtected.WithMessage("内置角色不可停用")
		}
		values["status"] = *req.Status
	}
	if req.Name != nil {
		values["name"] = *req.Name
	}
	if req.Description != nil {
		values["description"] = *req.Description
	}
	if len(values) > 0 {
		if err := s.roleRepo.UpdateColumns(ctx, id, values); err != nil {
			return nil, err
		}
	}
	return s.GetRole(ctx, id)
}

func (s *roleService) DeleteRole(ctx context.Context, id uuid.UUID) error {
	role, err := s.GetRole(ctx, id)
	if err != nil {
		return err
	}
	if role.BuiltIn {
		return coreerrors.ErrBuiltinProtected.WithMessage("内置角色不可删除")
	}
	if err := s.roleRepo.Delete(ctx, id); err != nil {
		return err
	}
	return s.authz.RemoveRolePolicies(role.Code)
}

func (s *roleService) AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error {
	if _, err := s.GetRole(ctx, roleID); err != nil {
		return err
	}
	if err := s.roleRepo.AssignPermissions(ctx, roleID, permissionIDs); err != nil {
		return err
	}
	return s.authz.SyncRolePolicies(ctx, roleID)
}
