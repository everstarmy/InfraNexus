package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

const (
	AuthTypeLocal = "local"
	AuthTypeAD    = "ad"
	AuthTypeLDAP  = "ldap"
)

// UserPreferences 用户界面与操作偏好 (利用 JSONType[T] 强类型序列化)
type UserPreferences struct {
	Theme        string   `json:"theme"`         // "dark" | "light" | "system"
	Locale       string   `json:"locale"`        // "zh-CN" | "en-US"
	PinnedRoutes []string `json:"pinned_routes"` // 侧栏快捷置顶路由
}

type User struct {
	BaseEntity
	Username          string                              `gorm:"size:64;not null;uniqueIndex:uidx_users_domain_username,priority:2,where:deleted_at IS NULL" json:"username"`
	Domain            string                              `gorm:"size:128;not null;default:'';uniqueIndex:uidx_users_domain_username,priority:1" json:"domain"`
	Email             string                              `gorm:"size:128;not null;uniqueIndex:uidx_users_email_nonempty,where:deleted_at IS NULL AND email <> ''" json:"email"`
	Password          string                              `gorm:"size:255;not null" json:"-"`
	Nickname          string                              `gorm:"size:64" json:"nickname"`
	Avatar            string                              `gorm:"size:255" json:"avatar"`
	Status            int                                 `gorm:"default:1" json:"status"` // 1: 启用, 2: 禁用
	AuthType          string                              `gorm:"size:16;not null;default:local;index" json:"auth_type"`
	ExternalID        string                              `gorm:"size:255;index" json:"external_id"`
	DepartmentID      *uuid.UUID                          `gorm:"type:uuid;index" json:"department_id"`
	Department        *Department                         `gorm:"foreignKey:DepartmentID" json:"department,omitempty"`
	BuiltIn           bool                                `gorm:"not null;default:false" json:"built_in"`
	LastLoginAt       *time.Time                          `json:"last_login_at"`
	SessionsRevokedAt *time.Time                          `json:"-"`
	Preferences       datatypes.JSONType[UserPreferences] `gorm:"type:jsonb" json:"preferences"`
	Roles             []Role                              `gorm:"many2many:sys_user_roles;foreignKey:ID;joinForeignKey:UserID;References:ID;joinReferences:RoleID" json:"roles"`
}

type UserFilter struct {
	Page            int
	PageSize        int
	Keyword         string
	Statuses        []int
	AuthTypes       []string
	RoleIDs         []uuid.UUID
	DepartmentID    *uuid.UUID
	IncludeChildren bool
	NoDepartment    bool
	DepartmentIDs   []uuid.UUID
	Sort            string
}

type CreateUserRequest struct {
	Username     string      `json:"username" validate:"required,min=3,max=32"`
	Email        string      `json:"email" validate:"required,email,max=128"`
	Password     string      `json:"password" validate:"required,max=128"`
	Nickname     string      `json:"nickname" validate:"max=64"`
	DepartmentID *uuid.UUID  `json:"department_id"`
	RoleIDs      []uuid.UUID `json:"role_ids" validate:"max=50"`
}

type UpdateUserRequest struct {
	Nickname     string      `json:"nickname" validate:"max=64"`
	Avatar       string      `json:"avatar" validate:"max=255"`
	Email        *string     `json:"email" validate:"omitempty,email,max=128"`
	Status       *int        `json:"status" validate:"omitempty,oneof=1 2"`
	DepartmentID *uuid.UUID  `json:"department_id"`
	RoleIDs      []uuid.UUID `json:"role_ids" validate:"max=50"`
}

type ResetPasswordRequest struct {
	Password string `json:"password" validate:"required,max=128"`
}

type AssignRolesRequest struct {
	RoleIDs []uuid.UUID `json:"role_ids" validate:"max=50"`
}

type BatchMoveDepartmentRequest struct {
	UserIDs      []uuid.UUID `json:"user_ids" validate:"required,min=1,max=500"`
	TargetDeptID uuid.UUID   `json:"target_dept_id" validate:"required"`
}

type DomainCount struct {
	Domain   string `json:"domain"`
	AuthType string `json:"auth_type"`
	Count    int64  `json:"count"`
}

type UserStats struct {
	Total      int64         `json:"total"`
	Active     int64         `json:"active"`
	Disabled   int64         `json:"disabled"`
	Local      int64         `json:"local"`
	Directory  int64         `json:"directory"`
	Unassigned int64         `json:"unassigned"`
	ByDomain   []DomainCount `json:"by_domain"`
}

type UserRepository interface {
	Repository[User, uuid.UUID]
	Search(ctx context.Context, f UserFilter) ([]User, int64, error)
	GetByUsername(ctx context.Context, authDomain, username string) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	GetByExternalID(ctx context.Context, authDomain, externalID string) (*User, error)
	ListByDomain(ctx context.Context, authDomain string) ([]User, error)
	FindByIDs(ctx context.Context, ids []uuid.UUID) ([]User, error)
	AssignRoles(ctx context.Context, userID uuid.UUID, roleIDs []uuid.UUID) error
	UpdateColumns(ctx context.Context, id uuid.UUID, values map[string]any) error
	MoveToDepartment(ctx context.Context, userIDs []uuid.UUID, deptID uuid.UUID) (int64, error)
	CountByDepartmentIDs(ctx context.Context, deptIDs []uuid.UUID) (int64, error)
	MemberCounts(ctx context.Context) (map[uuid.UUID]int64, error)
	Stats(ctx context.Context) (*UserStats, error)
	EmailOwners(ctx context.Context) (map[string]uuid.UUID, error)
}

type UserService interface {
	ListUsers(ctx context.Context, f UserFilter) ([]User, int64, error)
	GetUser(ctx context.Context, id uuid.UUID) (*User, error)
	Stats(ctx context.Context) (*UserStats, error)
	CreateUser(ctx context.Context, req CreateUserRequest) (*User, error)
	UpdateUser(ctx context.Context, actorID, id uuid.UUID, req UpdateUserRequest) (*User, error)
	DeleteUser(ctx context.Context, actorID, id uuid.UUID) error
	ToggleStatus(ctx context.Context, actorID, id uuid.UUID, status int) error
	ResetPassword(ctx context.Context, actorID, id uuid.UUID, password string) error
	AssignRoles(ctx context.Context, actorID, id uuid.UUID, roleIDs []uuid.UUID) (*User, error)
	BatchMoveDepartment(ctx context.Context, userIDs []uuid.UUID, deptID uuid.UUID) (int64, error)
	UpdatePreferences(ctx context.Context, id uuid.UUID, pref UserPreferences) error
}
