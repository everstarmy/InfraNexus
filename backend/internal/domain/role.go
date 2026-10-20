package domain

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type Role struct {
	BaseEntity
	Code        string         `gorm:"size:64;uniqueIndex;not null" json:"code"` // 如 "admin", "editor", "viewer"
	Name        string         `gorm:"size:64;not null" json:"name"`
	Description string         `gorm:"size:255" json:"description"`
	Status      int            `gorm:"default:1" json:"status"` // 1: 启用, 2: 禁用
	ExtraMeta   datatypes.JSON `gorm:"type:jsonb" json:"extra_meta"`
	Permissions []Permission   `gorm:"many2many:sys_role_permissions;foreignKey:ID;joinForeignKey:RoleID;References:ID;joinReferences:PermissionID" json:"permissions"`
}

type RoleRepository interface {
	Repository[Role, uuid.UUID]
	GetByCode(ctx context.Context, code string) (*Role, error)
	AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error
}

type RoleService interface {
	ListRoles(ctx context.Context, page, pageSize int) ([]Role, int64, error)
	CreateRole(ctx context.Context, role *Role) error
	UpdateRole(ctx context.Context, role *Role) error
	DeleteRole(ctx context.Context, id uuid.UUID) error
	AssignPermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error
}
