package service

import (
	"context"

	"infranexus/internal/domain"
)

type dashboardService struct {
	users domain.UserRepository
	depts domain.DepartmentRepository
	roles domain.RoleRepository
	perms domain.PermissionRepository
	ldap  domain.LDAPRepository
}

func NewDashboardService(users domain.UserRepository, depts domain.DepartmentRepository, roles domain.RoleRepository, perms domain.PermissionRepository, ldap domain.LDAPRepository) domain.DashboardService {
	return &dashboardService{users: users, depts: depts, roles: roles, perms: perms, ldap: ldap}
}

func (s *dashboardService) Overview(ctx context.Context) (*domain.DashboardOverview, error) {
	userStats, err := s.users.Stats(ctx)
	if err != nil {
		return nil, err
	}
	overview := &domain.DashboardOverview{Users: *userStats, Directories: []domain.DirectorySummary{}}
	depts, err := s.depts.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	for _, d := range depts {
		overview.Departments.Total++
		if d.Status == domain.StatusEnabled {
			overview.Departments.Enabled++
		} else {
			overview.Departments.Disabled++
		}
		if d.Source == domain.SourceLDAP {
			overview.Departments.FromDirectory++
		}
	}
	roles, err := s.roles.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	for _, r := range roles {
		overview.Roles.Total++
		if r.BuiltIn {
			overview.Roles.BuiltIn++
		}
	}
	counts, err := s.perms.CountByType(ctx)
	if err != nil {
		return nil, err
	}
	overview.Permissions = domain.PermissionStats{Menus: counts[domain.PermTypeMenu], Buttons: counts[domain.PermTypeButton], APIs: counts[domain.PermTypeAPI]}
	configs, err := s.ldap.ListConfigs(ctx)
	if err != nil {
		return nil, err
	}
	for _, c := range configs {
		overview.Directories = append(overview.Directories, domain.DirectorySummary{
			ID: c.ID, Name: c.Name, Domain: c.Domain, Type: c.Type, Enabled: c.Enabled,
			SyncEnabled: c.SyncEnabled, SyncStatus: c.SyncStatus, LastSyncAt: c.LastSyncAt,
		})
	}
	logs, _, err := s.ldap.ListLogs(ctx, nil, 1, 5)
	if err != nil {
		return nil, err
	}
	overview.RecentSyncs = logs
	return overview, nil
}
