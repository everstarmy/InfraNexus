package service

import (
	"context"

	"github.com/casbin/casbin/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/errors"
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

func (s *roleService) CreateRole(ctx context.Context, role *domain.Role) error {
	if existing, _ := s.roleRepo.GetByCode(ctx, role.Code); existing != nil {
		return errors.NewDomainError(409, 409001, "角色代码已存在")
	}
	return s.roleRepo.Create(ctx, role)
}

func (s *roleService) UpdateRole(ctx context.Context, role *domain.Role) error {
	return s.roleRepo.Update(ctx, role)
}

func (s *roleService) DeleteRole(ctx context.Context, id uuid.UUID) error {
	role, err := s.roleRepo.GetByID(ctx, id)
	if err != nil {
		return errors.ErrRoleNotFound
	}

	// 从 Casbin 移除策略
	if s.enforcer != nil {
		_, _ = s.enforcer.RemoveFilteredPolicy(0, role.Code)
		_ = s.enforcer.SavePolicy()
	}

	return s.roleRepo.Delete(ctx, id)
}

func (s *roleService) AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error {
	role, err := s.roleRepo.GetByID(ctx, roleID)
	if err != nil {
		return errors.ErrRoleNotFound
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
