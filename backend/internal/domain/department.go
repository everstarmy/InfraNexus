package domain

import (
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
