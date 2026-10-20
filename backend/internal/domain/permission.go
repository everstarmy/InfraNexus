package domain

import (
	"context"

	"github.com/google/uuid"
)

type PermissionType string

const (
	PermTypeMenu   PermissionType = "menu"
	PermTypeButton PermissionType = "button"
	PermTypeAPI    PermissionType = "api"
)

type Permission struct {
	BaseEntity
	ParentID  *uuid.UUID     `gorm:"type:uuid;index" json:"parent_id"`
	Code      string         `gorm:"size:64;not null;uniqueIndex:uidx_permissions_code,where:deleted_at IS NULL" json:"code"` // 如 "users:create"
	Name      string         `gorm:"size:64;not null" json:"name"`
	Type      PermissionType `gorm:"size:16;not null" json:"type"` // menu | button | api
	Path      string         `gorm:"size:255" json:"path"`         // 路由路径或 API Path
	Method    string         `gorm:"size:16" json:"method"`        // GET, POST, PUT, DELETE
	Component string         `gorm:"size:255" json:"component"`    // 前端组件标识
	Icon      string         `gorm:"size:64" json:"icon"`
	SortOrder int            `gorm:"default:0" json:"sort_order"`
	Children  []Permission   `gorm:"-" json:"children,omitempty"`
}

type PermissionRepository interface {
	Repository[Permission, uuid.UUID]
	GetTree(ctx context.Context) ([]Permission, error)
	GetByRoleID(ctx context.Context, roleID uuid.UUID) ([]Permission, error)
}

type PermissionService interface {
	Tree(ctx context.Context) ([]Permission, error)
}
