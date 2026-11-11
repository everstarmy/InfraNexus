package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type LocationNode struct {
	Path           datatypes.JSON `gorm:"->;-:migration" json:"path,omitempty"`
	HasChildren    *bool          `gorm:"->;-:migration" json:"has_children,omitempty"`
	SecurityZoneID *uuid.UUID     `gorm:"->;-:migration" json:"security_zone_id,omitempty"`
	UID            uuid.UUID      `gorm:"column:uid;primaryKey" json:"uid"`
	Name           string         `json:"name"`
	Type           LocationType   `json:"type"`
	Parent         *uuid.UUID     `json:"parent"`
	Ext            datatypes.JSON `gorm:"type:jsonb" json:"ext"`
	Status         int            `json:"status"`
	Version        int64          `json:"version"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `json:"-"`
}

func (LocationNode) TableName() string { return "dc_location" }

type LocationNodeQuery struct {
	Floor          *int
	Row            string
	Column         *int
	VisibleTypes   []LocationType
	Status         int
	Parent         *uuid.UUID
	Types          []LocationType
	Search         string
	AcrossParents  bool
	Page, PageSize int
}

type LocationNodeRepository interface {
	Transaction(context.Context, func(context.Context) error) error
	Get(context.Context, uuid.UUID) (LocationNode, error)
	GetType(context.Context, uuid.UUID) (LocationType, error)
	List(context.Context, LocationNodeQuery) ([]LocationNode, int64, error)
	Create(context.Context, *LocationNode) error
	Update(context.Context, *LocationNode, int64) error
	SetRackSecurityZone(context.Context, uuid.UUID, *uuid.UUID) error
}

type LocationChange struct {
	SecurityZoneID *uuid.UUID     `json:"security_zone_id"`
	Action         string         `json:"-"`
	Version        int64          `json:"version"`
	Name           string         `json:"name"`
	Ext            datatypes.JSON `json:"ext"`
	Status         int            `json:"status"`
}

type LocationTreeService interface {
	Get(context.Context, uuid.UUID) (LocationNode, error)
	GetType(context.Context, uuid.UUID) (LocationType, error)
	List(context.Context, LocationNodeQuery) ([]LocationNode, int64, error)
	Create(context.Context, uuid.UUID, string, LocationFields) (LocationNode, error)
	Change(context.Context, uuid.UUID, uuid.UUID, LocationChange) (LocationNode, error)
	History(context.Context, uuid.UUID, ManagedQuery) ([]ManagedAudit, int64, error)
	Units(context.Context, uuid.UUID) (RackUnitView, error)
	References(context.Context, uuid.UUID) ([]ManagedReferenceCount, error)
}
