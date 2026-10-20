package domain

import (
	"context"
	"errors"
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
	Username   string `json:"username" validate:"max=64"`
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

const (
	SyncActionCreate    = "create"
	SyncActionUpdate    = "update"
	SyncActionUnchanged = "unchanged"
	SyncActionDisable   = "disable"
	SyncActionSkip      = "skip"
	SyncActionConflict  = "conflict"
)

var (
	ErrDirectoryUnavailable        = errors.New("directory: server unavailable")
	ErrDirectoryBindFailed         = errors.New("directory: service account bind failed")
	ErrDirectoryInvalidCredentials = errors.New("directory: invalid user credentials")
	ErrDirectoryAccountDisabled    = errors.New("directory: account disabled")
)

type LDAPConfigRequest struct {
	Name                string               `json:"name" validate:"required,min=1,max=64"`
	Type                string               `json:"type" validate:"required,oneof=ad ldap"`
	Domain              string               `json:"domain" validate:"required,max=128,hostname_rfc1123"`
	ServerHost          string               `json:"server_host" validate:"required,max=255"`
	Port                int                  `json:"port" validate:"required,min=1,max=65535"`
	UseSSL              bool                 `json:"use_ssl"`
	StartTLS            bool                 `json:"start_tls"`
	InsecureSkipVerify  bool                 `json:"insecure_skip_verify"`
	BindDN              string               `json:"bind_dn" validate:"required,max=512"`
	BindPassword        string               `json:"bind_password" validate:"max=256"`
	BaseDN              string               `json:"base_dn" validate:"required,max=512"`
	UserFilter          string               `json:"user_filter" validate:"required,max=512,contains=%s"`
	AttributeMapping    LDAPAttributeMapping `json:"attribute_mapping"`
	DepartmentSync      LDAPDepartmentSync   `json:"department_sync"`
	DefaultRoleID       *uuid.UUID           `json:"default_role_id"`
	Enabled             bool                 `json:"enabled"`
	SyncEnabled         bool                 `json:"sync_enabled"`
	SyncIntervalMinutes int                  `json:"sync_interval_minutes" validate:"min=0,max=10080"`
	DisableMissingUsers bool                 `json:"disable_missing_users"`
	TimeoutSeconds      int                  `json:"timeout_seconds" validate:"min=0,max=60"`
}

type LDAPTestRequest struct {
	ConfigID *uuid.UUID `json:"config_id"`
	LDAPConfigRequest
}

type LDAPTestResult struct {
	Success     bool     `json:"success"`
	Stage       string   `json:"stage"`
	Message     string   `json:"message"`
	LatencyMs   int64    `json:"latency_ms"`
	ServerURL   string   `json:"server_url"`
	SampleUsers []string `json:"sample_users"`
}

type LDAPSyncRequest struct {
	ConfigID uuid.UUID `json:"config_id" validate:"required"`
	Mode     string    `json:"mode" validate:"omitempty,oneof=full incremental"`
}

type DirectoryUser struct {
	DN         string
	ExternalID string
	Username   string
	Email      string
	Nickname   string
	Department string
	Disabled   bool
}

type SyncPlanItem struct {
	Action     string     `json:"action"`
	Username   string     `json:"username"`
	Nickname   string     `json:"nickname"`
	Email      string     `json:"email"`
	DN         string     `json:"dn"`
	Department string     `json:"department"`
	UserID     *uuid.UUID `json:"user_id,omitempty"`
	Changes    []string   `json:"changes,omitempty"`
	Reason     string     `json:"reason,omitempty"`
}

type SyncSummary struct {
	Total               int `json:"total"`
	Create              int `json:"create"`
	Update              int `json:"update"`
	Unchanged           int `json:"unchanged"`
	Disable             int `json:"disable"`
	Skip                int `json:"skip"`
	Conflict            int `json:"conflict"`
	DepartmentsToCreate int `json:"departments_to_create"`
}

type SyncPlan struct {
	ConfigID            uuid.UUID      `json:"config_id"`
	Domain              string         `json:"domain"`
	Mode                string         `json:"mode"`
	GeneratedAt         time.Time      `json:"generated_at"`
	Summary             SyncSummary    `json:"summary"`
	Items               []SyncPlanItem `json:"items"`
	DepartmentsToCreate []string       `json:"departments_to_create"`
	Truncated           bool           `json:"truncated"`
}

type DirectoryGateway interface {
	Test(ctx context.Context, cfg *LDAPConfig, bindPassword string) (*LDAPTestResult, error)
	Authenticate(ctx context.Context, cfg *LDAPConfig, bindPassword, username, password string) (*DirectoryUser, error)
	SearchUsers(ctx context.Context, cfg *LDAPConfig, bindPassword string, changedSince *time.Time) ([]DirectoryUser, error)
}

type LDAPRepository interface {
	ListConfigs(ctx context.Context) ([]LDAPConfig, error)
	GetConfig(ctx context.Context, id uuid.UUID) (*LDAPConfig, error)
	GetConfigByDomain(ctx context.Context, domainName string) (*LDAPConfig, error)
	CreateConfig(ctx context.Context, cfg *LDAPConfig) error
	SaveConfig(ctx context.Context, cfg *LDAPConfig) error
	DeleteConfig(ctx context.Context, id uuid.UUID) error
	TryAcquireSync(ctx context.Context, id uuid.UUID, now, staleBefore time.Time) (bool, error)
	ReleaseSync(ctx context.Context, id uuid.UUID, status string, finishedAt time.Time, successAt *time.Time) error
	CreateLog(ctx context.Context, log *LDAPSyncLog) error
	SaveLog(ctx context.Context, log *LDAPSyncLog) error
	ListLogs(ctx context.Context, configID *uuid.UUID, page, pageSize int) ([]LDAPSyncLog, int64, error)
}

type AuthDomain struct {
	Domain string `json:"domain"`
	Name   string `json:"name"`
	Type   string `json:"type"`
}

type DirectoryAuthenticator interface {
	AuthenticateDomain(ctx context.Context, domainName, username, password string) (*User, error)
	ListLoginDomains(ctx context.Context) ([]AuthDomain, error)
}

type EventPublisher interface {
	Publish(event string, data any)
}

type LDAPService interface {
	DirectoryAuthenticator
	ListConfigs(ctx context.Context) ([]LDAPConfig, error)
	GetConfig(ctx context.Context, id uuid.UUID) (*LDAPConfig, error)
	CreateConfig(ctx context.Context, req LDAPConfigRequest) (*LDAPConfig, error)
	UpdateConfig(ctx context.Context, id uuid.UUID, req LDAPConfigRequest) (*LDAPConfig, error)
	DeleteConfig(ctx context.Context, id uuid.UUID) error
	TestConnection(ctx context.Context, req LDAPTestRequest) (*LDAPTestResult, error)
	Preview(ctx context.Context, configID uuid.UUID, mode string) (*SyncPlan, error)
	StartSync(ctx context.Context, configID uuid.UUID, mode, trigger string, operatorID *uuid.UUID) (*LDAPSyncLog, error)
	RunDueSyncs(ctx context.Context, now time.Time) int
	ListSyncLogs(ctx context.Context, configID *uuid.UUID, page, pageSize int) ([]LDAPSyncLog, int64, error)
	Close()
}
