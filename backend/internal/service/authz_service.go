package service

import (
	"context"
	"slices"
	"sort"
	"strings"

	"github.com/casbin/casbin/v3"
	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type authorizationService struct {
	enforcer *casbin.SyncedEnforcer
	roleRepo domain.RoleRepository
	permRepo domain.PermissionRepository
}

func NewAuthorizationService(enforcer *casbin.SyncedEnforcer, roleRepo domain.RoleRepository, permRepo domain.PermissionRepository) domain.AuthorizationService {
	return &authorizationService{enforcer: enforcer, roleRepo: roleRepo, permRepo: permRepo}
}

func rolePolicies(role domain.Role) [][]string {
	rules := make([][]string, 0)
	seen := make(map[string]bool)
	for _, p := range role.Permissions {
		if p.Type != domain.PermTypeAPI || p.Path == "" || p.Method == "" {
			continue
		}
		key := p.Path + " " + p.Method
		if seen[key] {
			continue
		}
		seen[key] = true
		rules = append(rules, []string{role.Code, p.Path, p.Method})
	}
	return rules
}

func policyKey(rule []string) string {
	return strings.Join(rule, "\x00")
}

func (s *authorizationService) applyDiff(current, desired [][]string) (int, int, error) {
	want := make(map[string][]string, len(desired))
	for _, rule := range desired {
		want[policyKey(rule)] = rule
	}
	have := make(map[string]bool, len(current))
	toRemove := make([][]string, 0)
	for _, rule := range current {
		key := policyKey(rule)
		have[key] = true
		if _, ok := want[key]; !ok {
			toRemove = append(toRemove, rule)
		}
	}
	toAdd := make([][]string, 0)
	for key, rule := range want {
		if !have[key] {
			toAdd = append(toAdd, rule)
		}
	}
	sort.Slice(toAdd, func(i, j int) bool { return policyKey(toAdd[i]) < policyKey(toAdd[j]) })
	if len(toRemove) > 0 {
		if _, err := s.enforcer.RemovePolicies(toRemove); err != nil {
			return 0, 0, err
		}
	}
	if len(toAdd) > 0 {
		if _, err := s.enforcer.AddPolicies(toAdd); err != nil {
			return 0, 0, err
		}
	}
	return len(toAdd), len(toRemove), nil
}

func (s *authorizationService) SyncRolePolicies(ctx context.Context, roleID uuid.UUID) error {
	role, err := s.roleRepo.GetByID(ctx, roleID)
	if err != nil {
		return notFoundAs(err, coreerrors.ErrRoleNotFound)
	}
	current, err := s.enforcer.GetFilteredPolicy(0, role.Code)
	if err != nil {
		return err
	}
	_, _, err = s.applyDiff(current, rolePolicies(*role))
	return err
}

func (s *authorizationService) SyncAllPolicies(ctx context.Context) (int, int, error) {
	roles, err := s.roleRepo.ListWithPermissions(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	desired := make([][]string, 0)
	for _, role := range roles {
		desired = append(desired, rolePolicies(role)...)
	}
	current, err := s.enforcer.GetPolicy()
	if err != nil {
		return 0, 0, err
	}
	return s.applyDiff(current, desired)
}

func (s *authorizationService) RemoveRolePolicies(roleCode string) error {
	_, err := s.enforcer.RemoveFilteredPolicy(0, roleCode)
	return err
}

func (s *authorizationService) EffectivePermissions(ctx context.Context, roleCodes []string) ([]string, bool, error) {
	if slices.Contains(roleCodes, domain.AdminRoleCode) {
		return []string{domain.AllPermissions}, true, nil
	}
	if len(roleCodes) == 0 {
		return []string{}, false, nil
	}
	roles, err := s.roleRepo.ListWithPermissions(ctx, roleCodes)
	if err != nil {
		return nil, false, err
	}
	all, err := s.permRepo.ListAll(ctx)
	if err != nil {
		return nil, false, err
	}
	byID := make(map[uuid.UUID]domain.Permission, len(all))
	for _, p := range all {
		byID[p.ID] = p
	}
	granted := make(map[string]bool)
	for _, role := range roles {
		if role.Status != domain.StatusEnabled {
			continue
		}
		for _, p := range role.Permissions {
			granted[p.Code] = true
			for parent := p.ParentID; parent != nil; {
				ancestor, ok := byID[*parent]
				if !ok || granted[ancestor.Code] {
					break
				}
				granted[ancestor.Code] = true
				parent = ancestor.ParentID
			}
		}
	}
	codes := make([]string, 0, len(granted))
	for code := range granted {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes, false, nil
}
