package domain

import (
	"context"

	"github.com/google/uuid"
)

type Warehouse struct {
	ManagedBase
	DatacenterID  uuid.UUID `gorm:"column:datacenter_id;type:uuid;not null;index" json:"datacenter_id" validate:"required"`
	ContactPerson string    `gorm:"column:contact_person;size:128" json:"contact_person" validate:"max=128"`
}

func (Warehouse) TableName() string { return "dc_warehouse" }

type Shelf struct {
	ManagedBase
	WarehouseID uuid.UUID `gorm:"column:warehouse_id;type:uuid;not null;index" json:"warehouse_id" validate:"required"`
	LayerCount  int       `gorm:"column:layer_count;not null;check:layer_count > 0" json:"layer_count" validate:"min=1,max=100"`
	Capacity    int       `gorm:"column:capacity;not null;check:capacity >= 0" json:"capacity" validate:"min=0"`
}

func (Shelf) TableName() string { return "dc_shelf" }

type Bin struct {
	ManagedBase
	ShelfID  uuid.UUID `gorm:"column:shelf_id;type:uuid;not null;index" json:"shelf_id" validate:"required"`
	Layer    int       `gorm:"column:layer;not null;check:layer > 0" json:"layer" validate:"min=1,max=100"`
	Capacity int       `gorm:"column:capacity;not null;check:capacity >= 0" json:"capacity" validate:"min=0"`
}

func (Bin) TableName() string { return "dc_bin" }

type TemporaryLocation struct {
	ManagedBase
	DatacenterID uuid.UUID `gorm:"column:datacenter_id;type:uuid;not null;index" json:"datacenter_id" validate:"required"`
	OwnerID      uuid.UUID `gorm:"column:owner_id;type:uuid;not null;index" json:"owner_id" validate:"required"`
}

func (TemporaryLocation) TableName() string { return "dc_temporary_location" }

type RackUnitAllocation struct {
	BaseEntity
	RackID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:uidx_rack_unit,priority:1" json:"rack_id"`
	Unit      int       `gorm:"not null;uniqueIndex:uidx_rack_unit,priority:2;check:unit > 0" json:"unit"`
	SubjectID uuid.UUID `gorm:"type:uuid;not null" json:"subject_id"`
	State     string    `gorm:"size:16;not null;check:state IN ('reserved','in_use')" json:"state"`
}

func (RackUnitAllocation) TableName() string { return "dc_rack_unit_allocation" }

type RackUnit struct {
	Available bool       `json:"available"`
	Unit      int        `json:"unit"`
	State     string     `json:"state"`
	SubjectID *uuid.UUID `json:"subject_id,omitempty"`
}

type RackUnitView struct {
	RackID uuid.UUID  `json:"rack_id"`
	Units  []RackUnit `json:"units"`
}

type LocationInventoryRepository interface {
	RackUnits(context.Context, uuid.UUID) ([]RackUnitAllocation, error)
	MaxBinLayer(context.Context, uuid.UUID) (int, error)
}
