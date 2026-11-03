package service

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type roleService struct {
	roleRepo domain.RoleRepository
	permRepo domain.PermissionRepository
	authz    domain.AuthorizationService
}

func NewRoleService(roleRepo domain.RoleRepository, permRepo domain.PermissionRepository, authz domain.AuthorizationService) domain.RoleService {
	return &roleService{
		roleRepo: roleRepo,
		permRepo: permRepo,
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
	existing, err := s.roleRepo.GetByCode(ctx, req.Code)
	if err == nil && existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("角色代码已存在")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
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

func (s *roleService) ToggleStatus(ctx context.Context, id uuid.UUID, status int, expectedRevision int64) (*domain.Role, error) {
	role, err := s.GetRole(ctx, id)
	if err != nil {
		return nil, err
	}
	if role.BuiltIn && status != domain.StatusEnabled {
		return nil, coreerrors.ErrBuiltinProtected.WithMessage("内置角色不可停用")
	}
	if role.EditRevision != expectedRevision {
		return nil, coreerrors.ErrResourceConflict.WithMessage("角色状态已被其他管理员修改，请刷新后重试")
	}
	if err := s.roleRepo.UpdateStatus(ctx, id, status, expectedRevision); err != nil {
		if errors.Is(err, domain.ErrEditRevisionConflict) {
			return nil, coreerrors.ErrResourceConflict.WithMessage("角色状态已被其他管理员修改，请刷新后重试")
		}
		return nil, err
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
	return s.authz.RefreshIfStale(ctx)
}

func (s *roleService) AssignPermissions(ctx context.Context, actorRoles []string, roleID uuid.UUID, permissionIDs []uuid.UUID, expectedRevision int64) error {
	permissionIDs = uniqueUUIDs(permissionIDs)
	role, err := s.GetRole(ctx, roleID)
	if err != nil {
		return err
	}
	admin := slices.Contains(actorRoles, domain.AdminRoleCode)
	if role.Code == domain.AdminRoleCode && !admin {
		return coreerrors.ErrPermissionDenied.WithMessage("仅超级管理员可以修改超级管理员授权")
	}
	if !admin {
		seen := make(map[uuid.UUID]struct{}, len(permissionIDs))
		for _, permissionID := range permissionIDs {
			if _, exists := seen[permissionID]; exists {
				continue
			}
			seen[permissionID] = struct{}{}
			permission, err := s.authzPermission(ctx, permissionID)
			if err != nil {
				return err
			}
			if permission.Type != domain.PermTypeAPI {
				continue
			}
			if permission.Method == "*" || strings.Contains(permission.Path, "*") {
				return coreerrors.ErrPermissionDenied.WithMessage("只能授予自身已有的 API 权限范围")
			}
			allowed, err := s.authz.HasAPIAccess(ctx, actorRoles, permission.Method, permission.Path)
			if err != nil {
				return err
			}
			if !allowed {
				return coreerrors.ErrPermissionDenied.WithMessage("只能授予自身已有的 API 权限范围")
			}
		}
	}
	if err := s.roleRepo.AssignPermissions(ctx, roleID, permissionIDs, expectedRevision); err != nil {
		if errors.Is(err, domain.ErrEditRevisionConflict) {
			return coreerrors.ErrResourceConflict.WithMessage("角色授权已被其他管理员修改，请刷新后比较差异")
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return coreerrors.ErrPermissionNotFound.WithMessage("部分权限点不存在")
		}
		return err
	}
	return s.authz.RefreshIfStale(ctx)
}

func (s *roleService) authzPermission(ctx context.Context, id uuid.UUID) (*domain.Permission, error) {
	permission, err := s.permRepo.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, coreerrors.ErrPermissionNotFound
	}
	return permission, err
}
