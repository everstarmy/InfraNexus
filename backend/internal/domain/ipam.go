package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type NetworkScope struct {
	ManagedBase
	RoutingDomainRef string `gorm:"column:routing_domain_ref;size:128" json:"routing_domain_ref" validate:"max=128"`
}

func (NetworkScope) TableName() string { return "ipam_network_scope" }

type SecurityZone struct {
	ManagedBase
	DatacenterID uuid.UUID `gorm:"column:datacenter_id;type:uuid;not null;index" json:"datacenter_id" validate:"required"`
}

func (SecurityZone) TableName() string { return "ipam_security_zone" }

type Subnet struct {
	ManagedBase
	NetworkScopeID uuid.UUID                   `gorm:"column:network_scope_id;type:uuid;not null;index" json:"network_scope_id" validate:"required"`
	SecurityZoneID uuid.UUID                   `gorm:"column:security_zone_id;type:uuid;not null;index" json:"security_zone_id" validate:"required"`
	CIDR           string                      `gorm:"column:cidr;type:cidr;not null" json:"cidr" validate:"required,max=32"`
	PrefixLength   int                         `gorm:"column:prefix_length;not null" json:"prefix_length" validate:"-"`
	NetworkStart   int64                       `gorm:"column:network_start;not null" json:"network_start" validate:"-"`
	NetworkEnd     int64                       `gorm:"column:network_end;not null" json:"network_end" validate:"-"`
	Gateway        string                      `gorm:"column:gateway;size:15" json:"gateway" validate:"max=15"`
	VLANID         *int                        `gorm:"column:vlan_id;check:vlan_id BETWEEN 1 AND 4094" json:"vlan_id" validate:"omitempty,min=1,max=4094"`
	UsageType      string                      `gorm:"column:usage_type;size:32;not null" json:"usage_type" validate:"required,oneof=bmc storage_management business_management production heartbeat vip other"`
	DNSServers     datatypes.JSONSlice[string] `gorm:"column:dns_servers;type:jsonb" json:"dns_servers" validate:"max=8,dive,max=45"`
	IsAllocatable  bool                        `gorm:"column:is_allocatable;not null" json:"is_allocatable" validate:"-"`
}

func (Subnet) TableName() string { return "ipam_subnet" }

type IPAddress struct {
	BaseEntity
	SubnetID         uuid.UUID  `gorm:"type:uuid;not null;index:idx_ipam_address_subnet,priority:1" json:"subnet_id"`
	NetworkScopeID   uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:uidx_ipam_scope_address,priority:1" json:"network_scope_id"`
	IPInteger        int64      `gorm:"not null;uniqueIndex:uidx_ipam_scope_address,priority:2;index:idx_ipam_address_subnet,priority:2;check:ip_integer BETWEEN 0 AND 4294967295" json:"-"`
	AllocationState  string     `gorm:"size:16;not null;check:allocation_state IN ('free','reserved','in_use','quarantined')" json:"allocation_state"`
	ManuallyReserved bool       `gorm:"not null" json:"-"`
	CooldownUntil    *time.Time `json:"cooldown_until,omitempty"`
	Version          int64      `gorm:"not null;check:version > 0" json:"version"`
}

func (IPAddress) TableName() string { return "ipam_ip_address" }

type IPConflict struct {
	BaseEntity
	AddressID        uuid.UUID  `gorm:"type:uuid;not null;index" json:"address_id"`
	ObservedIdentity string     `gorm:"size:128;not null" json:"observed_identity"`
	EvidenceRef      string     `gorm:"size:256;not null" json:"evidence_ref"`
	ObservedAt       time.Time  `gorm:"not null" json:"observed_at"`
	ReportedBy       uuid.UUID  `gorm:"type:uuid;not null" json:"reported_by"`
	ResolvedAt       *time.Time `json:"resolved_at,omitempty"`
	ResolvedBy       *uuid.UUID `gorm:"type:uuid" json:"resolved_by,omitempty"`
	ResolutionReason string     `gorm:"size:256" json:"resolution_reason,omitempty"`
}

func (IPConflict) TableName() string { return "ipam_conflict" }

type IPAddressView struct {
	ID              *uuid.UUID `json:"id,omitempty"`
	Address         string     `json:"address"`
	AllocationState string     `json:"allocation_state"`
	ReservationKind string     `json:"reservation_kind"`
	CooldownUntil   *time.Time `json:"cooldown_until,omitempty"`
	Conflicted      bool       `json:"conflicted"`
	Available       bool       `json:"available"`
	Version         int64      `json:"version"`
}

type IPAddressReservationRequest struct {
	ExpectedVersion *int64 `json:"expected_version" validate:"required,gte=0"`
	Reserved        *bool  `json:"reserved" validate:"required"`
	Reason          string `json:"reason" validate:"required,max=256"`
}

type IPConflictRequest struct {
	ObservedIdentity string    `json:"observed_identity" validate:"required,max=128"`
	EvidenceRef      string    `json:"evidence_ref" validate:"required,max=256"`
	ObservedAt       time.Time `json:"observed_at" validate:"required"`
}

type IPConflictResolution struct {
	Reason string `json:"reason" validate:"required,max=256"`
}

type AddressPoolRepository interface {
	Find(context.Context, uuid.UUID, int64) (*IPAddress, error)
	Range(context.Context, uuid.UUID, int64, int64) ([]IPAddress, map[uuid.UUID]bool, error)
	Create(context.Context, *IPAddress) error
	Update(context.Context, *IPAddress) error
	Conflicts(context.Context, uuid.UUID, ManagedQuery) ([]IPConflict, int64, error)
	CreateConflict(context.Context, *IPConflict) error
	ResolveConflict(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, time.Time) (bool, error)
}

type AddressPoolService interface {
	List(context.Context, uuid.UUID, ManagedQuery) ([]IPAddressView, int64, error)
	Detail(context.Context, uuid.UUID, string) (IPAddressView, error)
	Reserve(context.Context, uuid.UUID, uuid.UUID, string, IPAddressReservationRequest) (IPAddressView, error)
	History(context.Context, uuid.UUID, string, ManagedQuery) ([]ManagedAudit, int64, error)
	Conflicts(context.Context, uuid.UUID, string, ManagedQuery) ([]IPConflict, int64, error)
	ReportConflict(context.Context, uuid.UUID, uuid.UUID, string, string, IPConflictRequest) (*IPConflict, error)
	ResolveConflict(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, IPConflictResolution) error
}

type SubnetOverlapRepository interface {
	SubnetOverlaps(context.Context, uuid.UUID, uuid.UUID, string) (bool, error)
}
