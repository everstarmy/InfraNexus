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

const unclassifiedAPIGroup = domain.UnclassifiedAPIGroup

type RoutesProvider func() ([]domain.RouteInfo, error)

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

func (s *permissionService) Update(ctx context.Context, actorRoles []string, id uuid.UUID, req domain.PermissionRequest) (*domain.Permission, error) {
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
	if (perm.Path != req.Path || perm.Method != req.Method) && !slices.Contains(actorRoles, domain.AdminRoleCode) {
		if req.Method == "*" || strings.Contains(req.Path, "*") {
			return nil, coreerrors.ErrPermissionDenied.WithMessage("只有超级管理员可以配置通配 API 权限")
		}
		allowed, err := s.authz.HasAPIAccess(ctx, actorRoles, req.Method, req.Path)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, coreerrors.ErrPermissionDenied.WithMessage("不能将 API 权限改写到自身范围以外")
		}
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
	if err := s.permRepo.UpdateWithAuthorization(ctx, perm); err != nil {
		return nil, err
	}
	if policyChanged {
		if err := s.authz.RefreshIfStale(ctx); err != nil {
			return nil, err
		}
	}
	return perm, nil
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
	if err := s.permRepo.DeleteWithLinks(ctx, id); err != nil {
		return err
	}
	return s.authz.RefreshIfStale(ctx)
}

func (s *permissionService) SyncRoutes(ctx context.Context) (*domain.RouteSyncReport, error) {
	report := &domain.RouteSyncReport{
		CreatedRoutes:   []domain.RouteInfo{},
		RetiredRoutes:   []domain.RouteInfo{},
		DuplicateRoutes: []domain.RouteInfo{},
		DriftedRoutes:   []domain.RouteInfo{},
	}
	routes := []domain.RouteInfo{}
	if s.routes != nil {
		var err error
		routes, err = s.routes()
		if err != nil {
			return nil, err
		}
	}
	report.Discovered = len(routes)
	all, err := s.permRepo.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	byIdentity := make(map[string][]domain.Permission, len(all))
	byCode := make(map[string]domain.Permission, len(all))
	for _, permission := range all {
		byCode[permission.Code] = permission
		if permission.Type == domain.PermTypeAPI {
			key := routeIdentity(domain.RouteInfo{Method: permission.Method, Path: permission.Path})
			byIdentity[key] = append(byIdentity[key], permission)
		}
	}
	discovered := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		identity := routeIdentity(route)
		discovered[identity] = struct{}{}
		code := domain.APIPermissionCode(route.Method, route.Path)
		candidates := byIdentity[identity]
		if len(candidates) > 1 {
			report.Duplicates += len(candidates) - 1
			report.DuplicateRoutes = append(report.DuplicateRoutes, route)
			report.Existing++
			continue
		}
		if len(candidates) == 1 {
			if routePermissionDrift(candidates[0], route) {
				report.FieldDrift++
				report.DriftedRoutes = append(report.DriftedRoutes, route)
			} else {
				report.Existing++
			}
			continue
		}
		if _, exists := byCode[code]; exists {
			report.FieldDrift++
			report.DriftedRoutes = append(report.DriftedRoutes, route)
			continue
		}
		parentCode, err := s.routeParentCode(ctx, route.Path)
		if err != nil {
			return nil, err
		}
		permission, created, err := s.permRepo.EnsureRoutePermission(ctx, route, parentCode)
		if err != nil {
			return nil, err
		}
		if created {
			report.Created++
			report.CreatedRoutes = append(report.CreatedRoutes, route)
		} else {
			report.Existing++
			if routePermissionDrift(*permission, route) {
				report.FieldDrift++
				report.DriftedRoutes = append(report.DriftedRoutes, route)
			}
		}
	}
	for _, permission := range all {
		if !permission.BuiltIn || permission.Type != domain.PermTypeAPI {
			continue
		}
		if _, active := discovered[routeIdentity(domain.RouteInfo{Method: permission.Method, Path: permission.Path})]; active {
			continue
		}
		report.Retired++
		report.RetiredRoutes = append(report.RetiredRoutes, domain.RouteInfo{Method: permission.Method, Path: permission.Path})
	}
	added, removed, err := s.authz.SyncAllPolicies(ctx)
	if err != nil {
		return nil, err
	}
	report.PoliciesAdded = added
	report.PoliciesRemoved = removed
	return report, nil
}

func routeIdentity(route domain.RouteInfo) string {
	return route.Method + "\x00" + route.Path
}

func routePermissionDrift(permission domain.Permission, route domain.RouteInfo) bool {
	return permission.Code != domain.APIPermissionCode(route.Method, route.Path) ||
		permission.Type != domain.PermTypeAPI || permission.Path != route.Path || permission.Method != route.Method
}

func (s *permissionService) routeParentCode(ctx context.Context, path string) (string, error) {
	rest := strings.TrimPrefix(path, "/api/v1/")
	module, _, _ := strings.Cut(rest, "/")
	if module != "" {
		if menu, err := s.permRepo.GetByCode(ctx, module); err == nil {
			if menu.Type == domain.PermTypeMenu {
				return module, nil
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
	}
	return unclassifiedAPIGroup, nil
}
