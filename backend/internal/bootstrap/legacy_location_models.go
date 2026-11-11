package bootstrap

import (
	"github.com/google/uuid"

	"infranexus/internal/domain"
)

// The v05 migration uses these types to reproduce its historical schema.
type legacyDatacenter struct {
	domain.ManagedBase
	Kind    string     `gorm:"column:kind;size:24;not null" json:"kind" validate:"required,oneof=primary metro_dr remote_dr"`
	Address string     `gorm:"column:address;size:512" json:"address" validate:"max=512"`
	OwnerID *uuid.UUID `gorm:"column:owner_id;type:uuid;index" json:"owner_id" validate:"omitempty"`
}

func (legacyDatacenter) TableName() string { return "dc_datacenter" }

type legacyBuilding struct {
	domain.ManagedBase
	DatacenterID uuid.UUID `gorm:"column:datacenter_id;type:uuid;not null;index" json:"datacenter_id" validate:"required"`
}

func (legacyBuilding) TableName() string { return "dc_building" }

type legacyFloor struct {
	domain.ManagedBase
	BuildingID uuid.UUID `gorm:"column:building_id;type:uuid;not null;index" json:"building_id" validate:"required"`
	Level      int       `gorm:"column:level;not null" json:"level" validate:"min=-50,max=500"`
}

func (legacyFloor) TableName() string { return "dc_floor" }

type legacyRoom struct {
	domain.ManagedBase
	FloorID      uuid.UUID `gorm:"column:floor_id;type:uuid;not null;index" json:"floor_id" validate:"required"`
	DatacenterID uuid.UUID `gorm:"column:datacenter_id;type:uuid;not null;index" json:"datacenter_id" validate:"-"`
}

func (legacyRoom) TableName() string { return "dc_room" }

type legacyRackRow struct {
	domain.ManagedBase
	RoomID uuid.UUID `gorm:"column:room_id;type:uuid;not null;index" json:"room_id" validate:"required"`
}

func (legacyRackRow) TableName() string { return "dc_rack_row" }

type legacyRack struct {
	domain.ManagedBase
	RackRowID      uuid.UUID  `gorm:"column:rack_row_id;type:uuid;not null;index" json:"rack_row_id" validate:"required"`
	RoomID         uuid.UUID  `gorm:"column:room_id;type:uuid;not null;index" json:"room_id" validate:"-"`
	SecurityZoneID *uuid.UUID `gorm:"column:security_zone_id;type:uuid;index" json:"security_zone_id" validate:"omitempty"`
	Units          int        `gorm:"column:units;not null;check:units BETWEEN 1 AND 100" json:"units" validate:"min=1,max=100"`
	MaxLoadKG      int        `gorm:"column:max_load_kg;not null;check:max_load_kg >= 0" json:"max_load_kg" validate:"min=0,max=100000"`
	Label          string     `gorm:"column:label;size:128" json:"label" validate:"max=128"`
}

func (legacyRack) TableName() string { return "dc_rack" }
