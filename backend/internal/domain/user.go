package domain

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// UserPreferences 用户界面与操作偏好 (利用 JSONType[T] 强类型序列化)
type UserPreferences struct {
	Theme        string   `json:"theme"`         // "dark" | "light" | "system"
	Locale       string   `json:"locale"`        // "zh-CN" | "en-US"
	PinnedRoutes []string `json:"pinned_routes"` // 侧栏快捷置顶路由
}

type User struct {
	BaseEntity
	Username    string                              `gorm:"size:64;uniqueIndex;not null" json:"username"`
	Email       string                              `gorm:"size:128;uniqueIndex;not null" json:"email"`
	Password    string                              `gorm:"size:255;not null" json:"-"`
	Nickname    string                              `gorm:"size:64" json:"nickname"`
	Avatar      string                              `gorm:"size:255" json:"avatar"`
	Status      int                                 `gorm:"default:1" json:"status"` // 1: 启用, 2: 禁用
	Preferences datatypes.JSONType[UserPreferences] `gorm:"type:jsonb" json:"preferences"`
	Roles       []Role                              `gorm:"many2many:sys_user_roles;foreignKey:ID;joinForeignKey:UserID;References:ID;joinReferences:RoleID" json:"roles"`
}

type UserFilter struct {
	Page     int
	PageSize int
	Keyword  string
	Status   *int
	RoleID   *uuid.UUID
}

type CreateUserRequest struct {
	Username string      `json:"username" validate:"required,min=3,max=32"`
	Email    string      `json:"email" validate:"required,email"`
	Password string      `json:"password" validate:"required,min=6,max=64"`
	Nickname string      `json:"nickname" validate:"max=64"`
	RoleIDs  []uuid.UUID `json:"role_ids"`
}

type UpdateUserRequest struct {
	Nickname string      `json:"nickname" validate:"max=64"`
	Avatar   string      `json:"avatar"`
	Status   *int        `json:"status"`
	RoleIDs  []uuid.UUID `json:"role_ids"`
}

type UserRepository interface {
	Repository[User, uuid.UUID]
	GetByUsername(ctx context.Context, username string) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	AssignRoles(ctx context.Context, userID uuid.UUID, roleIDs []uuid.UUID) error
}

type UserService interface {
	Authenticate(ctx context.Context, username, password string) (*User, error)
	CreateUser(ctx context.Context, req CreateUserRequest) (*User, error)
	UpdateUser(ctx context.Context, id uuid.UUID, req UpdateUserRequest) (*User, error)
	DeleteUser(ctx context.Context, id uuid.UUID) error
	ToggleStatus(ctx context.Context, id uuid.UUID, status int) error
	UpdatePreferences(ctx context.Context, id uuid.UUID, pref UserPreferences) error
}
