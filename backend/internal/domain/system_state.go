package domain

import (
	"time"

	"github.com/google/uuid"
)

var (
	OrganizationStateID  = uuid.MustParse("018f2a51-55b2-7f19-9000-000000000001")
	AuthorizationStateID = uuid.MustParse("018f2a51-55b2-7f19-9000-000000000002")
)

// OrganizationState is the singleton revision used to serialize organization tree writes.
type OrganizationState struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	Revision  int64     `gorm:"not null;default:1"`
	UpdatedAt time.Time
}

func (OrganizationState) TableName() string { return "organization_state" }

// AuthorizationState tracks the committed policy generation shared by all service instances.
type AuthorizationState struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	Revision  int64     `gorm:"not null;default:1"`
	UpdatedAt time.Time
}

func (AuthorizationState) TableName() string { return "authorization_state" }

// AuthorizationOutbox records committed policy generations for cross-instance refresh workers.
type AuthorizationOutbox struct {
	BaseEntity
	Revision      int64     `gorm:"not null;uniqueIndex"`
	Event         string    `gorm:"size:64;not null"`
	AttemptCount  int       `gorm:"not null;default:0"`
	NextAttemptAt time.Time `gorm:"not null;index"`
	LastError     string    `gorm:"size:512"`
	ProcessedAt   *time.Time
}

func (AuthorizationOutbox) TableName() string { return "authorization_outbox" }

// SchemaMigration records idempotent schema and data migration checkpoints.
type SchemaMigration struct {
	BaseEntity
	Version string `gorm:"size:64;not null;uniqueIndex"`
}

func (SchemaMigration) TableName() string { return "schema_migrations" }
