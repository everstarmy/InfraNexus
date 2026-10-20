package service

import (
	"context"

	"github.com/casbin/casbin/v3"
	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type roleService struct {
	roleRepo domain.RoleRepository
	permRepo domain.PermissionRepository
	enforcer *casbin.Enforcer
}

func NewRoleService(roleRepo domain.RoleRepository, permRepo domain.PermissionRepository, enforcer *casbin.Enforcer) domain.RoleService {
	return &roleService{
		roleRepo: roleRepo,
		permRepo: permRepo,
		enforcer: enforcer,
	}
}

func (s *roleService) ListRoles(ctx context.Context, page, pageSize int) ([]domain.Role, int64, error) {
	return s.roleRepo.List(ctx, page, pageSize, nil)
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
	if req.Status != nil {
		if role.BuiltIn && *req.Status != domain.StatusEnabled {
			return nil, coreerrors.ErrBuiltinProtected.WithMessage("内置角色不可停用")
		}
		role.Status = *req.Status
	}
	if req.Name != nil {
		role.Name = *req.Name
	}
	if req.Description != nil {
		role.Description = *req.Description
	}
	if err := s.roleRepo.Update(ctx, role); err != nil {
		return nil, err
	}
	return role, nil
}

func (s *roleService) DeleteRole(ctx context.Context, id uuid.UUID) error {
	role, err := s.GetRole(ctx, id)
	if err != nil {
		return err
	}
	if role.BuiltIn {
		return coreerrors.ErrBuiltinProtected.WithMessage("内置角色不可删除")
	}

	// 从 Casbin 移除策略
	if s.enforcer != nil {
		_, _ = s.enforcer.RemoveFilteredPolicy(0, role.Code)
		_ = s.enforcer.SavePolicy()
	}

	return s.roleRepo.Delete(ctx, id)
}

func (s *roleService) AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error {
	role, err := s.GetRole(ctx, roleID)
	if err != nil {
		return err
	}

	if err := s.roleRepo.AssignPermissions(ctx, roleID, permissionIDs); err != nil {
		return err
	}

	// 重新加载并同步 Casbin 策略
	if s.enforcer != nil {
		// 清理旧规则
		_, _ = s.enforcer.RemoveFilteredPolicy(0, role.Code)

		perms, err := s.permRepo.GetByRoleID(ctx, roleID)
		if err == nil {
			for _, p := range perms {
				if p.Type == domain.PermTypeAPI && p.Path != "" && p.Method != "" {
					_, _ = s.enforcer.AddPolicy(role.Code, p.Path, p.Method)
				}
			}
		}
		_ = s.enforcer.SavePolicy()
	}

	return nil
}
