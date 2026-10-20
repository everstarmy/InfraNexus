package domain

import (
	"context"

	"github.com/google/uuid"
)

const AllPermissions = "*"

type RouteInfo struct {
	Method string `json:"method"`
	Path   string `json:"path"`
}

type RouteSyncReport struct {
	Discovered      int         `json:"discovered"`
	Created         int         `json:"created"`
	Existing        int         `json:"existing"`
	PoliciesAdded   int         `json:"policies_added"`
	PoliciesRemoved int         `json:"policies_removed"`
	CreatedRoutes   []RouteInfo `json:"created_routes"`
}

type AuthorizationService interface {
	SyncRolePolicies(ctx context.Context, roleID uuid.UUID) error
	SyncAllPolicies(ctx context.Context) (added, removed int, err error)
	RemoveRolePolicies(roleCode string) error
	EffectivePermissions(ctx context.Context, roleCodes []string) (codes []string, isAdmin bool, err error)
}
