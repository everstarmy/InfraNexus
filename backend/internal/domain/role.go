package domain

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

const AdminRoleCode = "admin"

type Role struct {
	BaseEntity
	EditRevision int64          `gorm:"not null;default:1" json:"edit_revision"`
	Code         string         `gorm:"size:64;not null;uniqueIndex:uidx_roles_code,where:deleted_at IS NULL" json:"code"` // 如 "admin", "editor", "viewer"
	Name         string         `gorm:"size:64;not null" json:"name"`
	Description  string         `gorm:"size:255" json:"description"`
	Status       int            `gorm:"default:1" json:"status"` // 1: 启用, 2: 禁用
	BuiltIn      bool           `gorm:"not null;default:false" json:"built_in"`
	UserCount    int64          `gorm:"->;-:migration" json:"user_count"`
	ExtraMeta    datatypes.JSON `gorm:"type:jsonb" json:"extra_meta"`
	Permissions  []Permission   `gorm:"many2many:sys_role_permissions;foreignKey:ID;joinForeignKey:RoleID;References:ID;joinReferences:PermissionID" json:"permissions"`
}

type CreateRoleRequest struct {
	Code        string `json:"code" validate:"required,min=2,max=32,slug"`
	Name        string `json:"name" validate:"required,min=2,max=64"`
	Description string `json:"description" validate:"max=255"`
}

type UpdateRoleRequest struct {
	Name        *string `json:"name" validate:"omitempty,min=2,max=64"`
	Description *string `json:"description" validate:"omitempty,max=255"`
	Status      *int    `json:"status" validate:"omitempty,oneof=1 2"`
}

type RoleRepository interface {
	Repository[Role, uuid.UUID]
	GetByCode(ctx context.Context, code string) (*Role, error)
	ListAll(ctx context.Context) ([]Role, error)
	Search(ctx context.Context, keyword string, page, pageSize int) ([]Role, int64, error)
	ListWithPermissions(ctx context.Context, codes []string) ([]Role, error)
	UpdateColumns(ctx context.Context, id uuid.UUID, values map[string]any) error
	UpdateStatus(ctx context.Context, id uuid.UUID, status int, expectedRevision int64) error
	AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID, expectedRevision int64) error
	SyncRoleAuthorizationPolicy(ctx context.Context, roleID uuid.UUID) error
	SyncAllAuthorizationPolicies(ctx context.Context) (added, removed int, err error)
}

type RoleService interface {
	ListRoles(ctx context.Context, keyword string, page, pageSize int) ([]Role, int64, error)
	Options(ctx context.Context) ([]Role, error)
	GetRole(ctx context.Context, id uuid.UUID) (*Role, error)
	CreateRole(ctx context.Context, req CreateRoleRequest) (*Role, error)
	UpdateRole(ctx context.Context, id uuid.UUID, req UpdateRoleRequest) (*Role, error)
	ToggleStatus(ctx context.Context, id uuid.UUID, status int, expectedRevision int64) (*Role, error)
	DeleteRole(ctx context.Context, id uuid.UUID) error
	AssignPermissions(ctx context.Context, actorRoles []string, roleID uuid.UUID, permissionIDs []uuid.UUID, expectedRevision int64) error
}
