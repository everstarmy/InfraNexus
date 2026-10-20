package domain

import (
	"context"
	"strings"

	"github.com/google/uuid"
)

const (
	SourceLocal = "local"
	SourceLDAP  = "ldap"

	DepartmentRootPath = "0"
	MaxDepartmentDepth = 15
)

type Department struct {
	BaseEntity
	ParentID   *uuid.UUID `gorm:"type:uuid;index" json:"parent_id"`
	TreePath   string     `gorm:"size:1024;not null;index" json:"tree_path"`
	Name       string     `gorm:"size:64;not null" json:"name"`
	Code       string     `gorm:"size:64;not null;uniqueIndex:uidx_departments_code,where:deleted_at IS NULL" json:"code"`
	SortOrder  int        `gorm:"not null;default:0" json:"sort_order"`
	LeaderID   *uuid.UUID `gorm:"type:uuid" json:"leader_id"`
	Phone      string     `gorm:"size:32" json:"phone"`
	Email      string     `gorm:"size:128" json:"email"`
	Status     int        `gorm:"not null;default:1" json:"status"`
	Source     string     `gorm:"size:16;not null;default:local" json:"source"`
	ExternalID string     `gorm:"size:512;index" json:"external_id"`
}

func DepartmentPath(parentPath string, id uuid.UUID) string {
	if parentPath == "" {
		parentPath = DepartmentRootPath
	}
	return parentPath + "/" + id.String()
}

func DepartmentDepth(treePath string) int {
	return strings.Count(treePath, "/")
}

type DepartmentTreeDTO struct {
	ID               uuid.UUID            `json:"id"`
	ParentID         *uuid.UUID           `json:"parent_id"`
	Name             string               `json:"name"`
	Code             string               `json:"code"`
	SortOrder        int                  `json:"sort_order"`
	LeaderID         *uuid.UUID           `json:"leader_id"`
	LeaderName       string               `json:"leader_name"`
	Phone            string               `json:"phone"`
	Email            string               `json:"email"`
	Status           int                  `json:"status"`
	Source           string               `json:"source"`
	TreePath         string               `json:"tree_path"`
	Depth            int                  `json:"depth"`
	MemberCount      int64                `json:"member_count"`
	TotalMemberCount int64                `json:"total_member_count"`
	Children         []*DepartmentTreeDTO `json:"children"`
}

type CreateDepartmentRequest struct {
	ParentID  *uuid.UUID `json:"parent_id"`
	Name      string     `json:"name" validate:"required,min=1,max=64"`
	Code      string     `json:"code" validate:"required,min=2,max=64,slug"`
	SortOrder int        `json:"sort_order" validate:"min=0,max=100000"`
	LeaderID  *uuid.UUID `json:"leader_id"`
	Phone     string     `json:"phone" validate:"max=32"`
	Email     string     `json:"email" validate:"omitempty,email,max=128"`
	Status    int        `json:"status" validate:"omitempty,oneof=1 2"`
}

type UpdateDepartmentRequest struct {
	Name      string     `json:"name" validate:"required,min=1,max=64"`
	Code      string     `json:"code" validate:"required,min=2,max=64,slug"`
	SortOrder int        `json:"sort_order" validate:"min=0,max=100000"`
	LeaderID  *uuid.UUID `json:"leader_id"`
	Phone     string     `json:"phone" validate:"max=32"`
	Email     string     `json:"email" validate:"omitempty,email,max=128"`
	Status    int        `json:"status" validate:"required,oneof=1 2"`
}

type MoveDepartmentRequest struct {
	ParentID *uuid.UUID `json:"parent_id"`
}

type DepartmentOrder struct {
	ID        uuid.UUID `json:"id" validate:"required"`
	SortOrder int       `json:"sort_order" validate:"min=0,max=100000"`
}

type ReorderDepartmentsRequest struct {
	Items []DepartmentOrder `json:"items" validate:"required,min=1,max=500,dive"`
}

type DepartmentRepository interface {
	Repository[Department, uuid.UUID]
	ListAll(ctx context.Context) ([]Department, error)
	GetByCode(ctx context.Context, code string) (*Department, error)
	GetByExternalID(ctx context.Context, source, externalID string) (*Department, error)
	FindChildByName(ctx context.Context, parentID *uuid.UUID, name string) (*Department, error)
	CountChildren(ctx context.Context, id uuid.UUID) (int64, error)
	ListSubtree(ctx context.Context, treePath string) ([]Department, error)
	Move(ctx context.Context, id uuid.UUID, parentID *uuid.UUID, oldPath, newPath string) error
	Reorder(ctx context.Context, items []DepartmentOrder) error
}

type DepartmentService interface {
	Tree(ctx context.Context) ([]*DepartmentTreeDTO, error)
	Get(ctx context.Context, id uuid.UUID) (*Department, error)
	Create(ctx context.Context, req CreateDepartmentRequest) (*Department, error)
	Update(ctx context.Context, id uuid.UUID, req UpdateDepartmentRequest) (*Department, error)
	Move(ctx context.Context, id uuid.UUID, parentID *uuid.UUID) (*Department, error)
	Reorder(ctx context.Context, items []DepartmentOrder) error
	Delete(ctx context.Context, id uuid.UUID) error
}
