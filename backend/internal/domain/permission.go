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
	Code      string         `gorm:"size:128;not null;uniqueIndex:uidx_permissions_code,where:deleted_at IS NULL" json:"code"` // 如 "users:create"
	Name      string         `gorm:"size:64;not null" json:"name"`
	Type      PermissionType `gorm:"size:16;not null" json:"type"` // menu | button | api
	Path      string         `gorm:"size:255" json:"path"`         // 路由路径或 API Path
	Method    string         `gorm:"size:16" json:"method"`        // GET, POST, PUT, DELETE
	Component string         `gorm:"size:255" json:"component"`    // 前端组件标识
	Icon      string         `gorm:"size:64" json:"icon"`
	SortOrder int            `gorm:"default:0" json:"sort_order"`
	BuiltIn   bool           `gorm:"not null;default:false" json:"built_in"`
	Children  []Permission   `gorm:"-" json:"children,omitempty"`
}

func APIPermissionCode(method, path string) string {
	return "api:" + method + ":" + path
}

type PermissionRequest struct {
	ParentID  *uuid.UUID     `json:"parent_id"`
	Code      string         `json:"code" validate:"required,min=2,max=128"`
	Name      string         `json:"name" validate:"required,min=1,max=64"`
	Type      PermissionType `json:"type" validate:"required,oneof=menu button api"`
	Path      string         `json:"path" validate:"max=255"`
	Method    string         `json:"method" validate:"omitempty,oneof=GET POST PUT PATCH DELETE *"`
	Component string         `json:"component" validate:"max=255"`
	Icon      string         `json:"icon" validate:"max=64"`
	SortOrder int            `json:"sort_order" validate:"min=0,max=100000"`
}

type PermissionRepository interface {
	Repository[Permission, uuid.UUID]
	ListAll(ctx context.Context) ([]Permission, error)
	GetTree(ctx context.Context) ([]Permission, error)
	GetByCode(ctx context.Context, code string) (*Permission, error)
	GetByRoleID(ctx context.Context, roleID uuid.UUID) ([]Permission, error)
	CountChildren(ctx context.Context, id uuid.UUID) (int64, error)
	RoleIDsByPermission(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error)
	DeleteWithLinks(ctx context.Context, id uuid.UUID) error
	CountByType(ctx context.Context) (map[PermissionType]int64, error)
}

type PermissionService interface {
	Tree(ctx context.Context) ([]Permission, error)
	Create(ctx context.Context, req PermissionRequest) (*Permission, error)
	Update(ctx context.Context, id uuid.UUID, req PermissionRequest) (*Permission, error)
	Delete(ctx context.Context, id uuid.UUID) error
	SyncRoutes(ctx context.Context) (*RouteSyncReport, error)
}
