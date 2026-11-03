package domain

import (
	"context"

	"github.com/google/uuid"
)

const (
	TableSelectionLimit = 500
	UserBatchLimit      = 200
	UserExportLimit     = 5000
)

// UserSelectionQuery deliberately excludes pagination. Ordering is presentation-only.
type UserSelectionQuery struct {
	Query           *TableQuery `json:"query,omitempty"`
	Keyword         string      `json:"keyword,omitempty"`
	Statuses        []int       `json:"statuses,omitempty"`
	AuthTypes       []string    `json:"auth_types,omitempty"`
	RoleIDs         []uuid.UUID `json:"role_ids,omitempty"`
	DepartmentID    *uuid.UUID  `json:"department_id,omitempty"`
	NoDepartment    bool        `json:"no_department,omitzero"`
	IncludeChildren bool        `json:"include_children,omitzero"`
}
type UserSelection struct {
	Mode        string             `json:"mode"`
	IDs         []uuid.UUID        `json:"ids,omitempty"`
	ExcludedIDs []uuid.UUID        `json:"excluded_ids,omitempty"`
	Query       UserSelectionQuery `json:"query"`
}
type UserBatchVersion struct {
	ID       uuid.UUID `json:"id"`
	Revision int64     `json:"revision"`
}
type UserBatchRequest struct {
	Selection UserSelection      `json:"selection"`
	Status    int                `json:"status" validate:"oneof=1 2"`
	Items     []UserBatchVersion `json:"items,omitempty"`
}
type UserBatchItem struct {
	ID        uuid.UUID `json:"id"`
	Revision  int64     `json:"revision"`
	Outcome   string    `json:"outcome"`
	Reason    string    `json:"reason,omitempty"`
	Retryable bool      `json:"retryable"`
}
type UserBatchPreview struct {
	Matched  int             `json:"matched"`
	Eligible int             `json:"eligible"`
	Skipped  int             `json:"skipped"`
	Items    []UserBatchItem `json:"items"`
}
type UserBatchResult struct {
	Success    int             `json:"success"`
	Failed     int             `json:"failed"`
	Skipped    int             `json:"skipped"`
	NewMatches int             `json:"new_matches"`
	Items      []UserBatchItem `json:"items"`
}
type UserExportRequest struct {
	Selection UserSelection `json:"selection"`
	Fields    []string      `json:"fields"`
}
type UserExport struct {
	Content []byte
	Rows    int
}

// Implemented by the existing user service; no general-purpose task infrastructure.
type UserTableActions interface {
	PreviewStatus(context.Context, uuid.UUID, UserBatchRequest) (*UserBatchPreview, error)
	BatchStatus(context.Context, uuid.UUID, UserBatchRequest) (*UserBatchResult, error)
	ExportUsers(context.Context, uuid.UUID, UserExportRequest) (*UserExport, error)
}
