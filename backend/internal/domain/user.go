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
	Theme          string   `json:"theme"`                     // "dark" | "light" | "system"
	Locale         string   `json:"locale"`                    // "zh-CN" | "en-US"
	PinnedRoutes   []string `json:"pinned_routes"`             // 侧栏快捷置顶路由
	SessionTimeout int      `json:"session_timeout,omitempty"` // 自定义空闲超时 (秒)，0 表示跟随系统默认
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
	AuthVersion       int64                               `gorm:"not null;default:1" json:"-"`
	EditRevision      int64                               `gorm:"not null;default:1" json:"edit_revision"`
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
	Username         string      `json:"username" validate:"required,min=3,max=32"`
	Email            string      `json:"email" validate:"required,email,max=128"`
	Password         string      `json:"password" validate:"required,max=128"`
	Nickname         string      `json:"nickname" validate:"max=64"`
	DepartmentID     *uuid.UUID  `json:"department_id"`
	ExpectedRevision int64       `json:"expected_revision" validate:"omitempty,gt=0"`
	RoleIDs          []uuid.UUID `json:"role_ids" validate:"max=50"`
}

type UpdateUserRequest struct {
	Nickname         *string `json:"nickname" validate:"omitempty,max=64"`
	Avatar           *string `json:"avatar" validate:"omitempty,max=255"`
	Email            *string `json:"email" validate:"omitempty,email,max=128"`
	ExpectedRevision int64   `json:"expected_revision" validate:"omitempty,gt=0"`
}

type UpdateUserDepartmentRequest struct {
	DepartmentID *uuid.UUID `json:"department_id"`
}

type ResetPasswordRequest struct {
	Password string `json:"password" validate:"required,max=128"`
}

type AssignRolesRequest struct {
	RoleIDs []uuid.UUID `json:"role_ids" validate:"max=50"`
}

type BatchMoveDepartmentRequest struct {
	UserIDs          []uuid.UUID `json:"user_ids" validate:"required,min=1,max=500"`
	TargetDeptID     uuid.UUID   `json:"target_dept_id" validate:"required"`
	ExpectedRevision int64       `json:"expected_revision" validate:"required,gt=0"`
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
	CreateWithRoles(ctx context.Context, user *User, roleIDs []uuid.UUID) error
	AssignRoles(ctx context.Context, userID uuid.UUID, roleIDs []uuid.UUID) error
	UpdateColumns(ctx context.Context, id uuid.UUID, values map[string]any) error
	UpdateColumnsCAS(ctx context.Context, id uuid.UUID, expectedRevision int64, values map[string]any) error
	UpdateStatus(ctx context.Context, id uuid.UUID, status int, expectedRevision int64) error
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
	CreateUser(ctx context.Context, actorID uuid.UUID, req CreateUserRequest) (*User, error)
	UpdateUser(ctx context.Context, actorID, id uuid.UUID, req UpdateUserRequest) (*User, error)
	SetDepartment(ctx context.Context, actorID, id uuid.UUID, departmentID *uuid.UUID, expectedRevision int64) (*User, error)
	DeleteUser(ctx context.Context, actorID, id uuid.UUID) error
	ToggleStatus(ctx context.Context, actorID, id uuid.UUID, status int, expectedRevision int64) (*User, error)
	ResetPassword(ctx context.Context, actorID, id uuid.UUID, password string) error
	AssignRoles(ctx context.Context, actorID, id uuid.UUID, roleIDs []uuid.UUID) (*User, error)
	BatchMoveDepartment(ctx context.Context, userIDs []uuid.UUID, deptID uuid.UUID, expectedRevision int64) (int64, error)
	UpdatePreferences(ctx context.Context, id uuid.UUID, pref UserPreferences) error
}
