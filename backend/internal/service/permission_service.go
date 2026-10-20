package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

const unclassifiedAPIGroup = "api-unclassified"

type RoutesProvider func() []domain.RouteInfo

type permissionService struct {
	permRepo domain.PermissionRepository
	authz    domain.AuthorizationService
	routes   RoutesProvider
}

func NewPermissionService(permRepo domain.PermissionRepository, authz domain.AuthorizationService, routes RoutesProvider) domain.PermissionService {
	return &permissionService{permRepo: permRepo, authz: authz, routes: routes}
}

func (s *permissionService) Tree(ctx context.Context) ([]domain.Permission, error) {
	return s.permRepo.GetTree(ctx)
}

func (s *permissionService) get(ctx context.Context, id uuid.UUID) (*domain.Permission, error) {
	perm, err := s.permRepo.GetByID(ctx, id)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrPermissionNotFound)
	}
	return perm, nil
}

func normalizePermission(req *domain.PermissionRequest) error {
	req.Code = strings.TrimSpace(req.Code)
	req.Name = strings.TrimSpace(req.Name)
	req.Path = strings.TrimSpace(req.Path)
	switch req.Type {
	case domain.PermTypeAPI:
		if req.Path == "" || req.Method == "" {
			return coreerrors.ErrParamInvalid.WithMessage("API 权限点必须填写路径与 HTTP 方法")
		}
		if !strings.HasPrefix(req.Path, "/") {
			return coreerrors.ErrParamInvalid.WithMessage("API 路径必须以 / 开头")
		}
	case domain.PermTypeButton:
		req.Path = ""
		req.Method = ""
	case domain.PermTypeMenu:
		req.Method = ""
	}
	return nil
}

func (s *permissionService) checkParent(ctx context.Context, selfID uuid.UUID, parentID *uuid.UUID) error {
	if parentID == nil {
		return nil
	}
	if *parentID == selfID {
		return coreerrors.ErrParamInvalid.WithMessage("上级权限点不能是自身")
	}
	all, err := s.permRepo.ListAll(ctx)
	if err != nil {
		return err
	}
	byID := make(map[uuid.UUID]domain.Permission, len(all))
	for _, p := range all {
		byID[p.ID] = p
	}
	parent, ok := byID[*parentID]
	if !ok {
		return coreerrors.ErrPermissionNotFound.WithMessage("上级权限点不存在")
	}
	for cursor := parent.ParentID; cursor != nil; {
		if *cursor == selfID {
			return coreerrors.ErrParamInvalid.WithMessage("不能把权限点挂到其下级节点之下")
		}
		next, ok := byID[*cursor]
		if !ok {
			break
		}
		cursor = next.ParentID
	}
	return nil
}

func (s *permissionService) checkCodeFree(ctx context.Context, selfID uuid.UUID, code string) error {
	existing, err := s.permRepo.GetByCode(ctx, code)
	if err == nil && existing.ID != selfID {
		return coreerrors.ErrResourceConflict.WithMessage("权限编码已存在")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func (s *permissionService) Create(ctx context.Context, req domain.PermissionRequest) (*domain.Permission, error) {
	if err := normalizePermission(&req); err != nil {
		return nil, err
	}
	if err := s.checkParent(ctx, uuid.Nil, req.ParentID); err != nil {
		return nil, err
	}
	if err := s.checkCodeFree(ctx, uuid.Nil, req.Code); err != nil {
		return nil, err
	}
	perm := domain.Permission{
		ParentID:  req.ParentID,
		Code:      req.Code,
		Name:      req.Name,
		Type:      req.Type,
		Path:      req.Path,
		Method:    req.Method,
		Component: req.Component,
		Icon:      req.Icon,
		SortOrder: req.SortOrder,
	}
	if err := s.permRepo.Create(ctx, &perm); err != nil {
		return nil, err
	}
	return &perm, nil
}

func (s *permissionService) Update(ctx context.Context, id uuid.UUID, req domain.PermissionRequest) (*domain.Permission, error) {
	perm, err := s.get(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := normalizePermission(&req); err != nil {
		return nil, err
	}
	if perm.BuiltIn && (req.Code != perm.Code || req.Type != perm.Type || req.Path != perm.Path || req.Method != perm.Method || !sameParent(req.ParentID, perm.ParentID)) {
		return nil, coreerrors.ErrBuiltinProtected.WithMessage("内置权限点仅允许修改名称、图标与排序")
	}
	if err := s.checkParent(ctx, perm.ID, req.ParentID); err != nil {
		return nil, err
	}
	if err := s.checkCodeFree(ctx, perm.ID, req.Code); err != nil {
		return nil, err
	}
	policyChanged := perm.Path != req.Path || perm.Method != req.Method || perm.Type != req.Type
	perm.ParentID = req.ParentID
	perm.Code = req.Code
	perm.Name = req.Name
	perm.Type = req.Type
	perm.Path = req.Path
	perm.Method = req.Method
	perm.Component = req.Component
	perm.Icon = req.Icon
	perm.SortOrder = req.SortOrder
	if err := s.permRepo.Update(ctx, perm); err != nil {
		return nil, err
	}
	if policyChanged {
		if err := s.resyncRolesOf(ctx, perm.ID); err != nil {
			return nil, err
		}
	}
	return perm, nil
}

func (s *permissionService) resyncRolesOf(ctx context.Context, permID uuid.UUID) error {
	roleIDs, err := s.permRepo.RoleIDsByPermission(ctx, permID)
	if err != nil {
		return err
	}
	for _, roleID := range roleIDs {
		if err := s.authz.SyncRolePolicies(ctx, roleID); err != nil {
			return err
		}
	}
	return nil
}

func (s *permissionService) Delete(ctx context.Context, id uuid.UUID) error {
	perm, err := s.get(ctx, id)
	if err != nil {
		return err
	}
	if perm.BuiltIn {
		return coreerrors.ErrBuiltinProtected.WithMessage("内置权限点不可删除")
	}
	children, err := s.permRepo.CountChildren(ctx, id)
	if err != nil {
		return err
	}
	if children > 0 {
		return coreerrors.ErrPermissionHasChildren
	}
	roleIDs, err := s.permRepo.RoleIDsByPermission(ctx, id)
	if err != nil {
		return err
	}
	if err := s.permRepo.DeleteWithLinks(ctx, id); err != nil {
		return err
	}
	for _, roleID := range roleIDs {
		if err := s.authz.SyncRolePolicies(ctx, roleID); err != nil {
			return err
		}
	}
	return nil
}

func (s *permissionService) SyncRoutes(ctx context.Context) (*domain.RouteSyncReport, error) {
	report := &domain.RouteSyncReport{CreatedRoutes: []domain.RouteInfo{}}
	routes := []domain.RouteInfo{}
	if s.routes != nil {
		routes = s.routes()
	}
	report.Discovered = len(routes)
	for _, route := range routes {
		code := domain.APIPermissionCode(route.Method, route.Path)
		_, err := s.permRepo.GetByCode(ctx, code)
		if err == nil {
			report.Existing++
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		parent, err := s.moduleParent(ctx, route.Path)
		if err != nil {
			return nil, err
		}
		perm := domain.Permission{
			ParentID: &parent.ID,
			Code:     code,
			Name:     route.Method + " " + route.Path,
			Type:     domain.PermTypeAPI,
			Path:     route.Path,
			Method:   route.Method,
		}
		if err := s.permRepo.Create(ctx, &perm); err != nil {
			return nil, err
		}
		report.Created++
		report.CreatedRoutes = append(report.CreatedRoutes, route)
	}
	added, removed, err := s.authz.SyncAllPolicies(ctx)
	if err != nil {
		return nil, err
	}
	report.PoliciesAdded = added
	report.PoliciesRemoved = removed
	return report, nil
}

func (s *permissionService) moduleParent(ctx context.Context, path string) (*domain.Permission, error) {
	rest := strings.TrimPrefix(path, "/api/v1/")
	module, _, _ := strings.Cut(rest, "/")
	if module != "" {
		if menu, err := s.permRepo.GetByCode(ctx, module); err == nil && menu.Type == domain.PermTypeMenu {
			return menu, nil
		}
	}
	group, err := s.permRepo.GetByCode(ctx, unclassifiedAPIGroup)
	if err == nil {
		return group, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	group = &domain.Permission{Code: unclassifiedAPIGroup, Name: "未归类接口", Type: domain.PermTypeMenu, Icon: "Unplug", SortOrder: 999}
	if err := s.permRepo.Create(ctx, group); err != nil {
		return nil, err
	}
	return group, nil
}
