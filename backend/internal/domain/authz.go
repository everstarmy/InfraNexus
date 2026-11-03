package domain

import (
	"context"
	"time"

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
	Retired         int         `json:"retired"`
	Duplicates      int         `json:"duplicates"`
	FieldDrift      int         `json:"field_drift"`
	PoliciesAdded   int         `json:"policies_added"`
	PoliciesRemoved int         `json:"policies_removed"`
	CreatedRoutes   []RouteInfo `json:"created_routes"`
	RetiredRoutes   []RouteInfo `json:"retired_routes"`
	DuplicateRoutes []RouteInfo `json:"duplicate_routes"`
	DriftedRoutes   []RouteInfo `json:"drifted_routes"`
}

type AuthorizationOutboxRepository interface {
	Revision(ctx context.Context) (int64, error)
	Pending(ctx context.Context, now time.Time, limit int) ([]AuthorizationOutbox, error)
	MarkPublished(ctx context.Context, id uuid.UUID, at time.Time) error
	MarkFailed(ctx context.Context, id uuid.UUID, message string, nextAttempt time.Time) error
}

type AuthorizationNotifier interface {
	Publish(ctx context.Context, revision int64) error
	Subscribe(ctx context.Context) (<-chan int64, error)
}

type AuthorizationService interface {
	SyncRolePolicies(ctx context.Context, roleID uuid.UUID) error
	SyncAllPolicies(ctx context.Context) (added, removed int, err error)
	Enforce(ctx context.Context, subject, object, action string) (bool, error)
	RefreshIfStale(ctx context.Context) error
	Run(ctx context.Context)
	EffectivePermissions(ctx context.Context, roleCodes []string) (codes []string, isAdmin bool, err error)
	HasAPIAccess(ctx context.Context, roleCodes []string, method, path string) (bool, error)
}
