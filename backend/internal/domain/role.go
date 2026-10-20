package domain

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

const AdminRoleCode = "admin"

type Role struct {
	BaseEntity
	Code        string         `gorm:"size:64;not null;uniqueIndex:uidx_roles_code,where:deleted_at IS NULL" json:"code"` // 如 "admin", "editor", "viewer"
	Name        string         `gorm:"size:64;not null" json:"name"`
	Description string         `gorm:"size:255" json:"description"`
	Status      int            `gorm:"default:1" json:"status"` // 1: 启用, 2: 禁用
	BuiltIn     bool           `gorm:"not null;default:false" json:"built_in"`
	ExtraMeta   datatypes.JSON `gorm:"type:jsonb" json:"extra_meta"`
	Permissions []Permission   `gorm:"many2many:sys_role_permissions;foreignKey:ID;joinForeignKey:RoleID;References:ID;joinReferences:PermissionID" json:"permissions"`
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
	AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error
}

type RoleService interface {
	ListRoles(ctx context.Context, page, pageSize int) ([]Role, int64, error)
	GetRole(ctx context.Context, id uuid.UUID) (*Role, error)
	CreateRole(ctx context.Context, req CreateRoleRequest) (*Role, error)
	UpdateRole(ctx context.Context, id uuid.UUID, req UpdateRoleRequest) (*Role, error)
	DeleteRole(ctx context.Context, id uuid.UUID) error
	AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error
}
