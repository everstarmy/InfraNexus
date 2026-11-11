package domain

import (
	"context"
	"encoding/json/jsontext"
	"errors"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

var (
	ErrManagedNotFound  = errors.New("managed record not found")
	ErrManagedReference = errors.New("managed record is referenced")
	ErrManagedKeyReuse  = errors.New("managed idempotency key reused with different input")
)

type ManagedBase struct {
	BaseEntity
	Code        string `gorm:"size:64;not null" json:"code" validate:"required,slug,max=64"`
	Name        string `gorm:"size:128;not null" json:"name" validate:"required,max=128"`
	Status      int    `gorm:"not null;check:status IN (1,2)" json:"status"`
	Version     int64  `gorm:"not null;check:version > 0" json:"version"`
	Description string `gorm:"size:1024" json:"description" validate:"max=1024"`
}

func (b *ManagedBase) ManagedFields() *ManagedBase { return b }

type ManagedEntity[T any] interface {
	*T
	ManagedFields() *ManagedBase
	TableName() string
}

type ManagedQuery struct {
	SecurityZoneID *uuid.UUID
	UsageType      string
	Page, PageSize int
	Search         string
	Status         int
	ParentID       *uuid.UUID
}

type QualificationAuditSnapshot struct {
	CertificateType string `json:"certificate_type,omitempty"`
	CertificateNo   string `json:"certificate_no"`
	Issuer          string `json:"issuer,omitempty"`
	Level           string `json:"level,omitempty"`
	ValidFrom       string `json:"valid_from"`
	ValidUntil      string `json:"valid_until"`
	EvidenceRef     string `json:"evidence_ref,omitempty"`
}

type ManagedAuditFields struct {
	Location      *LocationNode               `json:"location,omitempty"`
	Qualification *QualificationAuditSnapshot `json:"qualification,omitempty"`
	Code          string                      `json:"code,omitempty"`
	Status        int                         `json:"status,omitempty"`
	Version       int64                       `json:"version,omitempty"`
	Reservation   string                      `json:"reservation,omitempty"`
	EvidenceRef   string                      `json:"evidence_ref,omitempty"`
	Reason        string                      `json:"reason,omitempty"`
	ConflictID    *uuid.UUID                  `json:"conflict_id,omitempty"`
}

type ManagedAudit struct {
	BaseEntity
	Resource   string                                 `gorm:"size:64;not null;index:idx_foundation_audit_object,priority:1" json:"resource"`
	ResourceID uuid.UUID                              `gorm:"type:uuid;not null;index:idx_foundation_audit_object,priority:2" json:"resource_id"`
	ActorID    uuid.UUID                              `gorm:"type:uuid;not null" json:"actor_id"`
	RequestID  string                                 `gorm:"size:128" json:"request_id"`
	Action     string                                 `gorm:"size:32;not null" json:"action"`
	Before     datatypes.JSONType[ManagedAuditFields] `gorm:"not null" json:"before"`
	After      datatypes.JSONType[ManagedAuditFields] `gorm:"not null" json:"after"`
}

// Keep table names stable for databases that already ran the original migration.
func (ManagedAudit) TableName() string { return "foundation_audits" }

type ManagedReceipt struct {
	ActorID   uuid.UUID                          `gorm:"type:uuid;primaryKey"`
	Operation string                             `gorm:"size:96;primaryKey"`
	Key       string                             `gorm:"size:128;primaryKey"`
	Digest    string                             `gorm:"size:64;not null"`
	Result    datatypes.JSONType[jsontext.Value] `gorm:"not null"`
}

func (ManagedReceipt) TableName() string { return "foundation_receipts" }

type ManagedReference struct {
	Table, Column, Target string
}

// ManagedReferences is the shared registry of restrictive foreign keys and
// reference checks. It contains trusted schema identifiers only.
func LegacyManagedReferences() []ManagedReference {
	return []ManagedReference{
		{"dc_datacenter", "owner_id", "users"},
		{"dc_building", "datacenter_id", "dc_datacenter"},
		{"dc_floor", "building_id", "dc_building"},
		{"dc_room", "floor_id", "dc_floor"},
		{"dc_room", "datacenter_id", "dc_datacenter"},
		{"dc_rack_row", "room_id", "dc_room"},
		{"dc_rack", "rack_row_id", "dc_rack_row"},
		{"dc_rack", "room_id", "dc_room"},
		{"dc_rack", "security_zone_id", "ipam_security_zone"},
		{"dc_rack_unit_allocation", "rack_id", "dc_rack"},
		{"dc_warehouse", "datacenter_id", "dc_datacenter"},
		{"dc_shelf", "warehouse_id", "dc_warehouse"},
		{"dc_bin", "shelf_id", "dc_shelf"},
		{"dc_temporary_location", "datacenter_id", "dc_datacenter"},
		{"dc_temporary_location", "owner_id", "users"},
		{"ipam_security_zone", "datacenter_id", "dc_datacenter"},
		{"ipam_subnet", "network_scope_id", "ipam_network_scope"},
		{"ipam_subnet", "security_zone_id", "ipam_security_zone"},
		{"ipam_ip_address", "subnet_id", "ipam_subnet"},
		{"ipam_ip_address", "network_scope_id", "ipam_network_scope"},
		{"ipam_conflict", "address_id", "ipam_ip_address"},
		{"org_contact", "manufacturer_id", "org_manufacturer"},
		{"org_contact", "vendor_id", "org_vendor"},
		{"org_vendor", "primary_contact_id", "org_contact"},
		{"org_vendor_qualification", "vendor_id", "org_vendor"},
		{"org_vendor_qualification", "manufacturer_id", "org_manufacturer"},
		{"org_contact_certification", "contact_id", "org_contact"},
	}
}

func ManagedReferences() []ManagedReference {
	out := []ManagedReference{
		{"dc_location", "parent", "dc_location"},
		{"dc_rack_security_zone", "rack_id", "dc_location"},
		{"dc_rack_security_zone", "security_zone_id", "ipam_security_zone"},
	}
	for _, ref := range LegacyManagedReferences() {
		switch ref.Table {
		case "dc_datacenter", "dc_building", "dc_floor", "dc_room", "dc_rack_row", "dc_rack":
			continue
		}
		if ref.Target == "dc_datacenter" || ref.Target == "dc_rack" {
			ref.Target = "dc_location"
		}
		out = append(out, ref)
	}
	return out
}

type ManagedReferenceCount struct {
	Resource string `json:"resource"`
	Field    string `json:"field"`
	Count    int64  `json:"count"`
}

type ManagedUnitOfWork interface {
	References(context.Context, string, uuid.UUID) ([]ManagedReferenceCount, error)
	Write(context.Context, func(context.Context) error) error
	HasReferences(context.Context, string, uuid.UUID, bool) (bool, error)
	Audit(context.Context, *ManagedAudit) error
	History(context.Context, string, uuid.UUID, ManagedQuery) ([]ManagedAudit, int64, error)
	Receipt(context.Context, uuid.UUID, string, string) (*ManagedReceipt, error)
	SaveReceipt(context.Context, *ManagedReceipt) error
}

type ManagedRepository[T any] interface {
	GetByID(context.Context, uuid.UUID) (*T, error)
	List(context.Context, ManagedQuery) ([]T, int64, error)
	Create(context.Context, *T) error
	Update(context.Context, *T) error
	Delete(context.Context, uuid.UUID) error
}

type ManagedService[T any] interface {
	References(context.Context, uuid.UUID) ([]ManagedReferenceCount, error)
	List(context.Context, ManagedQuery) ([]T, int64, error)
	Get(context.Context, uuid.UUID) (*T, error)
	History(context.Context, uuid.UUID, ManagedQuery) ([]ManagedAudit, int64, error)
	Create(context.Context, uuid.UUID, string, T) (*T, error)
	Update(context.Context, uuid.UUID, uuid.UUID, int64, T) (*T, error)
	SetStatus(context.Context, uuid.UUID, uuid.UUID, int64, int) (*T, error)
	Delete(context.Context, uuid.UUID, uuid.UUID, int64) error
}
