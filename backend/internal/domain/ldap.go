package domain

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

const (
	DirectoryTypeAD   = "ad"
	DirectoryTypeLDAP = "ldap"

	DeptStrategyNone      = "none"
	DeptStrategyOU        = "ou"
	DeptStrategyAttribute = "attribute"

	SyncModeFull        = "full"
	SyncModeIncremental = "incremental"

	SyncTriggerManual   = "manual"
	SyncTriggerSchedule = "schedule"

	SyncStatusIdle    = "idle"
	SyncStatusRunning = "running"
	SyncStatusSuccess = "success"
	SyncStatusPartial = "partial"
	SyncStatusFailed  = "failed"
)

type LDAPAttributeMapping struct {
	Username   string `json:"username" validate:"required,max=64"`
	Email      string `json:"email" validate:"max=64"`
	Nickname   string `json:"nickname" validate:"max=64"`
	Department string `json:"department" validate:"max=64"`
	ExternalID string `json:"external_id" validate:"max=64"`
}

type OUMapping struct {
	OUDN         string    `json:"ou_dn" validate:"required,max=512"`
	DepartmentID uuid.UUID `json:"department_id" validate:"required"`
}

type LDAPDepartmentSync struct {
	Strategy         string      `json:"strategy" validate:"omitempty,oneof=none ou attribute"`
	RootDepartmentID *uuid.UUID  `json:"root_department_id"`
	OUMappings       []OUMapping `json:"ou_mappings" validate:"max=100,dive"`
}

type LDAPConfig struct {
	BaseEntity
	Name                string                                   `gorm:"size:64;not null" json:"name"`
	Type                string                                   `gorm:"size:16;not null" json:"type"`
	Domain              string                                   `gorm:"size:128;not null;uniqueIndex:uidx_ldap_configs_domain,where:deleted_at IS NULL" json:"domain"`
	ServerHost          string                                   `gorm:"size:255;not null" json:"server_host"`
	Port                int                                      `gorm:"not null" json:"port"`
	UseSSL              bool                                     `gorm:"not null;default:false" json:"use_ssl"`
	StartTLS            bool                                     `gorm:"not null;default:false" json:"start_tls"`
	InsecureSkipVerify  bool                                     `gorm:"not null;default:false" json:"insecure_skip_verify"`
	BindDN              string                                   `gorm:"size:512" json:"bind_dn"`
	BindPassword        string                                   `gorm:"size:1024" json:"-"`
	BaseDN              string                                   `gorm:"size:512;not null" json:"base_dn"`
	UserFilter          string                                   `gorm:"size:512;not null" json:"user_filter"`
	AttributeMapping    datatypes.JSONType[LDAPAttributeMapping] `gorm:"type:jsonb" json:"attribute_mapping"`
	DepartmentSync      datatypes.JSONType[LDAPDepartmentSync]   `gorm:"type:jsonb" json:"department_sync"`
	DefaultRoleID       *uuid.UUID                               `gorm:"type:uuid" json:"default_role_id"`
	Enabled             bool                                     `gorm:"not null;default:false" json:"enabled"`
	SyncEnabled         bool                                     `gorm:"not null;default:false" json:"sync_enabled"`
	SyncIntervalMinutes int                                      `gorm:"not null" json:"sync_interval_minutes"`
	DisableMissingUsers bool                                     `gorm:"not null;default:false" json:"disable_missing_users"`
	TimeoutSeconds      int                                      `gorm:"not null" json:"timeout_seconds"`
	SyncStatus          string                                   `gorm:"size:16;not null;default:idle" json:"sync_status"`
	SyncStartedAt       *time.Time                               `json:"sync_started_at"`
	LastSyncAt          *time.Time                               `json:"last_sync_at"`
	LastSuccessAt       *time.Time                               `json:"last_success_at"`
	HasBindPassword     bool                                     `gorm:"-" json:"has_bind_password"`
}

type SyncItemError struct {
	Username string `json:"username"`
	DN       string `json:"dn"`
	Reason   string `json:"reason"`
}

type SyncReport struct {
	Total              int             `json:"total"`
	Created            int             `json:"created"`
	Updated            int             `json:"updated"`
	Unchanged          int             `json:"unchanged"`
	Disabled           int             `json:"disabled"`
	Skipped            int             `json:"skipped"`
	Failed             int             `json:"failed"`
	DepartmentsCreated int             `json:"departments_created"`
	Errors             []SyncItemError `json:"errors"`
}

type LDAPSyncLog struct {
	BaseEntity
	ConfigID   uuid.UUID                      `gorm:"type:uuid;not null;index" json:"config_id"`
	Domain     string                         `gorm:"size:128;not null" json:"domain"`
	Trigger    string                         `gorm:"size:16;not null" json:"trigger"`
	Mode       string                         `gorm:"size:16;not null" json:"mode"`
	Status     string                         `gorm:"size:16;not null;index" json:"status"`
	StartedAt  time.Time                      `json:"started_at"`
	FinishedAt *time.Time                     `json:"finished_at"`
	DurationMs int64                          `json:"duration_ms"`
	Report     datatypes.JSONType[SyncReport] `gorm:"type:jsonb" json:"report"`
	Message    string                         `gorm:"size:1024" json:"message"`
	OperatorID *uuid.UUID                     `gorm:"type:uuid" json:"operator_id"`
}
