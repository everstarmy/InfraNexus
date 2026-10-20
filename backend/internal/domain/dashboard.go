package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type DepartmentStats struct {
	Total         int64 `json:"total"`
	Enabled       int64 `json:"enabled"`
	Disabled      int64 `json:"disabled"`
	FromDirectory int64 `json:"from_directory"`
}

type RoleStats struct {
	Total   int64 `json:"total"`
	BuiltIn int64 `json:"built_in"`
}

type PermissionStats struct {
	Menus   int64 `json:"menus"`
	Buttons int64 `json:"buttons"`
	APIs    int64 `json:"apis"`
}

type DirectorySummary struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"name"`
	Domain      string     `json:"domain"`
	Type        string     `json:"type"`
	Enabled     bool       `json:"enabled"`
	SyncEnabled bool       `json:"sync_enabled"`
	SyncStatus  string     `json:"sync_status"`
	LastSyncAt  *time.Time `json:"last_sync_at"`
}

type DashboardOverview struct {
	Users       UserStats          `json:"users"`
	Departments DepartmentStats    `json:"departments"`
	Roles       RoleStats          `json:"roles"`
	Permissions PermissionStats    `json:"permissions"`
	Directories []DirectorySummary `json:"directories"`
	RecentSyncs []LDAPSyncLog      `json:"recent_syncs"`
}

type DashboardService interface {
	Overview(ctx context.Context) (*DashboardOverview, error)
}
