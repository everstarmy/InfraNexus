package domain

import (
	"context"
	"encoding/json/jsontext"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// AssetRecord gives mutable records a stable identity and optimistic revision.
type AssetRecord struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	Version   int64     `gorm:"not null;default:1" json:"version"`
	CreatedAt time.Time `gorm:"not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"not null" json:"updated_at"`
}

// AssetSpec is the versioned, validated specification shared by catalog DTOs.
type AssetSpec struct {
	SchemaVersion       int      `json:"schema_version"`
	CapacityBytes       *int64   `json:"capacity_bytes,omitempty"`
	MemoryGeneration    *string  `json:"memory_generation,omitempty"`
	SpeedMTS            *int     `json:"speed_mt_s,omitempty"`
	ECC                 *bool    `json:"ecc,omitempty"`
	Interface           *string  `json:"interface,omitempty"`
	MediaType           *string  `json:"media_type,omitempty"`
	FormFactor          *string  `json:"form_factor,omitempty"`
	Socket              *string  `json:"socket,omitempty"`
	Cores               *int     `json:"cores,omitempty"`
	Threads             *int     `json:"threads,omitempty"`
	BaseFrequencyMHz    *int     `json:"base_frequency_mhz,omitempty"`
	Protocol            *string  `json:"protocol,omitempty"`
	PortCount           *int     `json:"port_count,omitempty"`
	SpeedMbps           *int64   `json:"speed_mbps,omitempty"`
	RatedPowerW         *int     `json:"rated_power_w,omitempty"`
	InputType           *string  `json:"input_type,omitempty"`
	CacheBytes          *int64   `json:"cache_bytes,omitempty"`
	HasNonvolatileCache *bool    `json:"has_nonvolatile_cache,omitempty"`
	Connector           *string  `json:"connector,omitempty"`
	WavelengthNM        *int     `json:"wavelength_nm,omitempty"`
	WidthMM             *float64 `json:"width_mm,omitempty"`
	DepthMM             *float64 `json:"depth_mm,omitempty"`
	WeightKG            *float64 `json:"weight_kg,omitempty"`
	Description         *string  `json:"description,omitempty"`
}
type AssetPosition struct {
	SchemaVersion int     `json:"schema_version"`
	Side          *string `json:"side,omitempty"`
	Row           *int    `json:"row,omitempty"`
	Column        *int    `json:"column,omitempty"`
}
type AssetLocation struct {
	WarehouseID   uuid.UUID  `json:"warehouse_id"`
	BinID         *uuid.UUID `json:"bin_id"`
	WarehouseName string     `json:"warehouse_name,omitempty"`
	BinName       string     `json:"bin_name,omitempty"`
	Path          string     `json:"path,omitempty"`
}
type AssetSnapshot struct {
	SchemaVersion    int            `json:"schema_version"`
	Name             string         `json:"name"`
	ManufacturerName string         `json:"manufacturer_name"`
	ModelRevisionID  uuid.UUID      `json:"model_revision_id"`
	SerialNumber     *string        `json:"serial_number"`
	Spec             AssetSpec      `json:"spec"`
	Location         *AssetLocation `json:"location,omitempty"`
}

type CatalogModel struct {
	LastRevisionNo int            `gorm:"not null;default:0" json:"-"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
	AssetRecord
	ManufacturerID uuid.UUID `gorm:"type:uuid;not null" json:"manufacturer_id"`
	Name           string    `gorm:"size:128;not null" json:"name"`
	PartNo         string    `gorm:"size:128" json:"part_no,omitempty"`
	ModelName      string    `gorm:"size:128" json:"model_name,omitempty"`
	NormalizedKey  string    `gorm:"size:128;not null" json:"-"`
	Kind           string    `gorm:"size:32" json:"kind,omitempty"`
	Category       string    `gorm:"size:32" json:"category,omitempty"`
	Status         int       `gorm:"not null" json:"status"`
	Description    string    `gorm:"size:1024" json:"description"`
}

func (CatalogModel) TableName() string { return "ast_device_model" }

type CatalogRevision struct {
	AssetRecord
	ModelID      uuid.UUID                     `gorm:"type:uuid;not null" json:"model_id"`
	Name         string                        `gorm:"size:128;not null;default:''" json:"name,omitempty"`
	Description  string                        `gorm:"size:1024;not null;default:''" json:"description,omitempty"`
	Status       int                           `gorm:"not null;default:1" json:"status"`
	RevisionNo   int                           `gorm:"not null" json:"revision_no"`
	State        string                        `gorm:"size:16;not null" json:"state"`
	TrackingMode string                        `gorm:"size:16" json:"tracking_mode,omitempty"`
	Unit         string                        `gorm:"size:16" json:"unit,omitempty"`
	MountingType string                        `gorm:"size:16" json:"mounting_type,omitempty"`
	HeightU      *int                          `gorm:"default:null" json:"height_u"`
	RatedPowerW  *int                          `gorm:"default:null" json:"rated_power_w"`
	Spec         datatypes.JSONType[AssetSpec] `gorm:"type:jsonb;not null" json:"spec"`
	PublishedAt  *time.Time                    `gorm:"default:null" json:"published_at"`
	PublishedBy  *uuid.UUID                    `gorm:"type:uuid" json:"published_by"`
}

func (CatalogRevision) TableName() string { return "ast_device_model_revision" }

type ModelSlot struct {
	AssetRecord
	RevisionID uuid.UUID                         `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	StableKey  string                            `gorm:"size:64;not null" json:"stable_key"`
	Name       string                            `gorm:"size:128;not null" json:"name"`
	Kind       string                            `gorm:"size:32;not null" json:"kind"`
	Interface  *string                           `gorm:"size:64" json:"interface"`
	FormFactor *string                           `gorm:"size:64" json:"form_factor"`
	Position   datatypes.JSONType[AssetPosition] `gorm:"type:jsonb;not null" json:"position"`
}

func (ModelSlot) TableName() string { return "ast_model_slot_template" }

type ModelPort struct {
	AssetRecord
	RevisionID uuid.UUID `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	StableKey  string    `gorm:"size:64;not null" json:"stable_key"`
	Name       string    `gorm:"size:128;not null" json:"name"`
	Protocol   string    `gorm:"size:64;not null" json:"protocol"`
	Connector  string    `gorm:"size:64;not null" json:"connector"`
	SpeedMbps  *int64    `gorm:"" json:"speed_mbps"`
	SourceKind string    `gorm:"size:16;not null" json:"source_kind"`
	SlotKey    *string   `gorm:"size:64" json:"slot_key"`
}

func (ModelPort) TableName() string { return "ast_model_port_template" }

type ModelComponent struct {
	AssetRecord
	RevisionID          uuid.UUID `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	PartModelRevisionID uuid.UUID `gorm:"type:uuid;not null" json:"part_model_revision_id"`
	SlotKey             *string   `gorm:"size:64" json:"slot_key"`
	Quantity            int       `gorm:"not null" json:"quantity"`
	Required            bool      `gorm:"not null" json:"required"`
}

func (ModelComponent) TableName() string { return "ast_model_standard_component" }

type ModelCompatibility struct {
	AssetRecord
	RevisionID          uuid.UUID  `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	PartModelRevisionID uuid.UUID  `gorm:"type:uuid;not null" json:"part_model_revision_id"`
	SlotKey             *string    `gorm:"size:64" json:"slot_key"`
	Status              string     `gorm:"size:16;not null" json:"status"`
	EvidenceNote        string     `gorm:"size:1024;not null" json:"evidence_note"`
	ConfirmedBy         *uuid.UUID `gorm:"type:uuid" json:"confirmed_by"`
	ConfirmedAt         *time.Time `gorm:"" json:"confirmed_at"`
}

func (ModelCompatibility) TableName() string { return "part_compatibility" }

type ArrivalOrder struct {
	AssetRecord
	Number              string     `gorm:"size:64;not null" json:"number"`
	Name                string     `gorm:"size:128;not null" json:"name"`
	SupplierID          uuid.UUID  `gorm:"type:uuid;not null" json:"supplier_id"`
	ExternalOrderNo     *string    `gorm:"size:128" json:"external_order_no"`
	ExpectedArrivalDate *AssetDate `gorm:"type:date" json:"expected_arrival_date"`
	Description         string     `gorm:"size:1024" json:"description"`
	State               string     `gorm:"size:16;not null" json:"state"`
	CreatedBy           uuid.UUID  `gorm:"type:uuid;not null" json:"created_by"`
	OpenedAt            *time.Time `gorm:"" json:"opened_at"`
	CompletedAt         *time.Time `gorm:"" json:"completed_at"`
	ClosedAt            *time.Time `gorm:"" json:"closed_at"`
	CloseReason         *string    `gorm:"size:1024" json:"close_reason"`
}

func (ArrivalOrder) TableName() string { return "ast_purchase_batch" }

type ArrivalLine struct {
	AssetRecord
	PurchaseBatchID       uuid.UUID `gorm:"type:uuid;not null" json:"purchase_batch_id"`
	LineNo                int       `gorm:"not null" json:"line_no"`
	DeviceModelRevisionID uuid.UUID `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	PlannedQuantity       int       `gorm:"not null" json:"planned_quantity"`
	AcceptedQuantity      int       `gorm:"not null" json:"accepted_quantity"`
	Note                  string    `gorm:"size:1024" json:"note"`
}

func (ArrivalLine) TableName() string { return "ast_purchase_line" }

type ArrivalComponent struct {
	AssetRecord
	PurchaseLineID      uuid.UUID `gorm:"type:uuid;not null" json:"purchase_line_id"`
	PartModelRevisionID uuid.UUID `gorm:"type:uuid;not null" json:"part_model_revision_id"`
	SlotKey             *string   `gorm:"size:64" json:"slot_key"`
	Quantity            int       `gorm:"not null" json:"quantity"`
	Required            bool      `gorm:"not null" json:"required"`
}

func (ArrivalComponent) TableName() string { return "ast_purchase_line_component" }

type Receipt struct {
	AssetRecord
	Number          string                            `gorm:"size:64;not null" json:"number"`
	PurchaseBatchID uuid.UUID                         `gorm:"type:uuid;not null" json:"purchase_batch_id"`
	State           string                            `gorm:"size:16;not null" json:"state"`
	Note            string                            `gorm:"size:1024" json:"note"`
	CreatedBy       uuid.UUID                         `gorm:"type:uuid;not null" json:"created_by"`
	CompletedBy     *uuid.UUID                        `gorm:"type:uuid" json:"completed_by"`
	CompletedAt     *time.Time                        `gorm:"" json:"completed_at"`
	CanceledAt      *time.Time                        `gorm:"" json:"canceled_at"`
	CancelReason    *string                           `gorm:"size:1024" json:"cancel_reason"`
	Result          datatypes.JSONType[ReceiptResult] `gorm:"type:jsonb;not null" json:"result"`
}

func (Receipt) TableName() string { return "ast_receipt" }

type ReceiptItem struct {
	SNRuleVersion int `gorm:"not null;default:1" json:"sn_rule_version"`
	AssetRecord
	ReceiptID              uuid.UUID  `gorm:"type:uuid;not null" json:"receipt_id"`
	PurchaseLineID         uuid.UUID  `gorm:"type:uuid;not null" json:"purchase_line_id"`
	DeviceModelRevisionID  uuid.UUID  `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	SerialNumber           *string    `gorm:"size:128" json:"serial_number"`
	NormalizedSN           *string    `gorm:"size:128" json:"-"`
	CustodyLocationID      *uuid.UUID `gorm:"type:uuid" json:"custody_location_id"`
	InspectionResult       string     `gorm:"size:16;not null" json:"inspection_result"`
	InspectedAt            *time.Time `gorm:"" json:"inspected_at"`
	DifferenceReason       *string    `gorm:"size:1024" json:"difference_reason"`
	RejectReason           *string    `gorm:"size:1024" json:"reject_reason"`
	ConfigurationConfirmed bool       `gorm:"not null" json:"configuration_confirmed"`
}

func (ReceiptItem) TableName() string { return "ast_receipt_item" }

type ReceiptComponent struct {
	SNRuleVersion int `gorm:"not null;default:1" json:"sn_rule_version"`
	AssetRecord
	ReceiptItemID       uuid.UUID  `gorm:"type:uuid;not null" json:"receipt_item_id"`
	PartModelRevisionID uuid.UUID  `gorm:"type:uuid;not null" json:"part_model_revision_id"`
	SerialNumber        *string    `gorm:"size:128" json:"serial_number"`
	NormalizedSN        *string    `gorm:"size:128" json:"-"`
	InitialPlacement    string     `gorm:"size:16;not null" json:"initial_placement"`
	SlotKey             *string    `gorm:"size:64" json:"slot_key"`
	CustodyLocationID   *uuid.UUID `gorm:"type:uuid" json:"custody_location_id"`
}

func (ReceiptComponent) TableName() string { return "ast_receipt_component" }

type CustodyLocation struct {
	AssetRecord
	Kind        string     `gorm:"size:16;not null" json:"kind"`
	WarehouseID *uuid.UUID `gorm:"type:uuid" json:"warehouse_id"`
	BinID       *uuid.UUID `gorm:"type:uuid" json:"bin_id"`
}

func (CustodyLocation) TableName() string { return "ast_custody_location" }

type AssetObject struct {
	AssetRecord
	ObjectType string `gorm:"size:16;not null" json:"object_type"`
}

func (AssetObject) TableName() string { return "res_object" }

type AssetDevice struct {
	SNRuleVersion int `gorm:"not null;default:1" json:"sn_rule_version"`
	AssetRecord
	AssetCode                string    `gorm:"size:64;not null" json:"asset_code"`
	DeviceModelRevisionID    uuid.UUID `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	ManufacturerID           uuid.UUID `gorm:"type:uuid;not null" json:"manufacturer_id"`
	SerialNumber             string    `gorm:"size:128;not null" json:"serial_number"`
	NormalizedSN             string    `gorm:"size:128;not null" json:"-"`
	SupplierID               uuid.UUID `gorm:"type:uuid;not null" json:"supplier_id"`
	SourceReceiptItemID      uuid.UUID `gorm:"type:uuid;not null" json:"source_receipt_item_id"`
	LifecycleState           string    `gorm:"size:16;not null" json:"lifecycle_state"`
	CurrentCustodyLocationID uuid.UUID `gorm:"type:uuid;not null" json:"current_custody_location_id"`
	ConfigurationVersion     int64     `gorm:"not null" json:"configuration_version"`
}

func (AssetDevice) TableName() string { return "ast_device" }

type AssetPart struct {
	SNRuleVersion int `gorm:"not null;default:1" json:"sn_rule_version"`
	AssetRecord
	InternalCode             string    `gorm:"size:64;not null" json:"internal_code"`
	PartModelRevisionID      uuid.UUID `gorm:"type:uuid;not null" json:"part_model_revision_id"`
	ManufacturerID           uuid.UUID `gorm:"type:uuid;not null" json:"manufacturer_id"`
	SerialNumber             *string   `gorm:"size:128" json:"serial_number"`
	NormalizedSN             *string   `gorm:"size:128" json:"-"`
	SourceReceiptComponentID uuid.UUID `gorm:"type:uuid;not null" json:"source_receipt_component_id"`
	QualityState             string    `gorm:"size:16;not null" json:"quality_state"`
}

func (AssetPart) TableName() string { return "part_item" }

type ReceiptBaseline struct {
	AssetRecord
	DeviceID              uuid.UUID                         `gorm:"type:uuid;not null" json:"device_id"`
	ReceiptItemID         uuid.UUID                         `gorm:"type:uuid;not null" json:"receipt_item_id"`
	DeviceModelRevisionID uuid.UUID                         `gorm:"type:uuid;not null" json:"device_model_revision_id"`
	Snapshot              datatypes.JSONType[AssetSnapshot] `gorm:"type:jsonb;not null" json:"snapshot"`
	AcceptedAt            time.Time                         `gorm:"not null" json:"accepted_at"`
	AcceptedBy            uuid.UUID                         `gorm:"type:uuid;not null" json:"accepted_by"`
	ActionID              uuid.UUID                         `gorm:"type:uuid;not null" json:"action_id"`
}

func (ReceiptBaseline) TableName() string { return "ast_receipt_baseline" }

type ReceiptBaselineItem struct {
	AssetRecord
	BaselineID            uuid.UUID                         `gorm:"type:uuid;not null" json:"baseline_id"`
	PartItemID            uuid.UUID                         `gorm:"type:uuid;not null" json:"part_item_id"`
	PartModelRevisionID   uuid.UUID                         `gorm:"type:uuid;not null" json:"part_model_revision_id"`
	Snapshot              datatypes.JSONType[AssetSnapshot] `gorm:"type:jsonb;not null" json:"snapshot"`
	SerialNumberAtReceipt *string                           `gorm:"size:128" json:"serial_number_at_receipt"`
	OriginalSlotKey       *string                           `gorm:"size:64" json:"original_slot_key"`
	OriginalPlacement     string                            `gorm:"size:16;not null" json:"original_placement"`
}

func (ReceiptBaselineItem) TableName() string { return "ast_receipt_baseline_item" }

type PartAllocation struct {
	AssetRecord
	PartItemID      uuid.UUID  `gorm:"type:uuid;not null" json:"part_item_id"`
	DeviceID        uuid.UUID  `gorm:"type:uuid;not null" json:"device_id"`
	SlotKey         *string    `gorm:"size:64" json:"slot_key"`
	InstalledAt     *time.Time `gorm:"" json:"installed_at"`
	RecordedAt      time.Time  `gorm:"not null" json:"recorded_at"`
	RemovedAt       *time.Time `gorm:"" json:"removed_at"`
	EndedRecordedAt *time.Time `gorm:"" json:"ended_recorded_at"`
	StartActionID   uuid.UUID  `gorm:"type:uuid;not null" json:"start_action_id"`
	EndActionID     *uuid.UUID `gorm:"type:uuid" json:"end_action_id"`
}

func (PartAllocation) TableName() string { return "part_slot_allocation" }

type PartPlacement struct {
	AssetRecord
	PartItemID        uuid.UUID  `gorm:"type:uuid;not null" json:"part_item_id"`
	Kind              string     `gorm:"size:16;not null" json:"kind"`
	AllocationID      *uuid.UUID `gorm:"type:uuid" json:"allocation_id"`
	CustodyLocationID *uuid.UUID `gorm:"type:uuid" json:"custody_location_id"`
	LastActionID      uuid.UUID  `gorm:"type:uuid;not null" json:"last_action_id"`
}

func (PartPlacement) TableName() string { return "part_current_placement" }

type AssetAction struct {
	AssetRecord
	Kind        string                             `gorm:"size:64;not null" json:"kind"`
	ResourceID  uuid.UUID                          `gorm:"type:uuid;not null" json:"resource_id"`
	ReceiptID   *uuid.UUID                         `gorm:"type:uuid" json:"receipt_id"`
	ActorUserID uuid.UUID                          `gorm:"type:uuid;not null" json:"actor_user_id"`
	RequestID   string                             `gorm:"size:128;not null" json:"request_id"`
	Before      datatypes.JSONType[jsontext.Value] `gorm:"type:jsonb;not null" json:"before"`
	After       datatypes.JSONType[jsontext.Value] `gorm:"type:jsonb;not null" json:"after"`
}

func (AssetAction) TableName() string { return "ast_asset_action" }

type PartMovement struct {
	AssetRecord
	PartItemID            uuid.UUID  `gorm:"type:uuid;not null" json:"part_item_id"`
	ActionID              uuid.UUID  `gorm:"type:uuid;not null" json:"action_id"`
	EventType             string     `gorm:"size:32;not null" json:"event_type"`
	FromDeviceID          *uuid.UUID `gorm:"type:uuid" json:"from_device_id"`
	FromCustodyLocationID *uuid.UUID `gorm:"type:uuid" json:"from_custody_location_id"`
	ToDeviceID            *uuid.UUID `gorm:"type:uuid" json:"to_device_id"`
	ToCustodyLocationID   *uuid.UUID `gorm:"type:uuid" json:"to_custody_location_id"`
	SlotKey               *string    `gorm:"size:64" json:"slot_key"`
	EffectiveAt           *time.Time `gorm:"" json:"effective_at"`
	RecordedAt            time.Time  `gorm:"not null" json:"recorded_at"`
}

func (PartMovement) TableName() string { return "part_movement_event" }

type PartIdentityEvent struct {
	AssetRecord
	PartItemID      uuid.UUID `gorm:"type:uuid;not null" json:"part_item_id"`
	ActionID        uuid.UUID `gorm:"type:uuid;not null" json:"action_id"`
	OldSerialNumber *string   `gorm:"size:128" json:"old_serial_number"`
	NewSerialNumber string    `gorm:"size:128;not null" json:"new_serial_number"`
	Reason          string    `gorm:"size:1024;not null" json:"reason"`
	ActorUserID     uuid.UUID `gorm:"type:uuid;not null" json:"actor_user_id"`
	RecordedAt      time.Time `gorm:"not null" json:"recorded_at"`
}

func (PartIdentityEvent) TableName() string { return "part_identity_event" }

type AssetAttachment struct {
	AssetRecord
	ReceiptItemID    uuid.UUID  `gorm:"type:uuid;not null" json:"receipt_item_id"`
	OriginalFilename string     `gorm:"size:255;not null" json:"original_filename"`
	DetectedMIME     string     `gorm:"size:64;not null" json:"detected_mime"`
	SizeBytes        int64      `gorm:"not null" json:"size_bytes"`
	SHA256           string     `gorm:"size:64;not null" json:"sha256"`
	Content          []byte     `gorm:"type:bytea;not null" json:"-"`
	UploadedBy       uuid.UUID  `gorm:"type:uuid;not null" json:"uploaded_by"`
	BaselineID       *uuid.UUID `gorm:"type:uuid" json:"baseline_id"`
}

func (AssetAttachment) TableName() string { return "core_attachment" }

type AssetCommandReceipt struct {
	AssetRecord
	ActorUserID uuid.UUID                          `gorm:"type:uuid;not null" json:"actor_user_id"`
	Operation   string                             `gorm:"size:128;not null" json:"operation"`
	TargetScope string                             `gorm:"size:128;not null" json:"target_scope"`
	Key         string                             `gorm:"size:128;not null" json:"key"`
	Digest      string                             `gorm:"size:64;not null" json:"digest"`
	Result      datatypes.JSONType[jsontext.Value] `gorm:"type:jsonb;not null" json:"result"`
}

func (AssetCommandReceipt) TableName() string { return "ast_command_receipt" }

// AssetFilter contains only named, bound comparisons; repositories validate column names.
type AssetFilter struct {
	Field string
	Value any
}
type AssetQuery struct {
	CreatedFrom, CreatedTo *time.Time
	Filters                []AssetFilter
	Search                 string
	Page, PageSize         int
	Lock                   bool
}
type AssetRows[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}
type AssetRepository[T any] interface {
	Get(context.Context, uuid.UUID, bool) (*T, error)
	List(context.Context, AssetQuery) (AssetRows[T], error)
	Create(context.Context, *T) error
	Save(context.Context, *T) error
	Delete(context.Context, uuid.UUID) error
}
type ReceivingRepositories struct {
	CatalogModels        AssetRepository[CatalogModel]
	CatalogRevisions     AssetRepository[CatalogRevision]
	ModelSlots           AssetRepository[ModelSlot]
	ModelPorts           AssetRepository[ModelPort]
	ModelComponents      AssetRepository[ModelComponent]
	ModelCompatibilitys  AssetRepository[ModelCompatibility]
	ArrivalOrders        AssetRepository[ArrivalOrder]
	ArrivalLines         AssetRepository[ArrivalLine]
	ArrivalComponents    AssetRepository[ArrivalComponent]
	Receipts             AssetRepository[Receipt]
	ReceiptItems         AssetRepository[ReceiptItem]
	ReceiptComponents    AssetRepository[ReceiptComponent]
	CustodyLocations     AssetRepository[CustodyLocation]
	AssetObjects         AssetRepository[AssetObject]
	AssetDevices         AssetRepository[AssetDevice]
	AssetParts           AssetRepository[AssetPart]
	ReceiptBaselines     AssetRepository[ReceiptBaseline]
	ReceiptBaselineItems AssetRepository[ReceiptBaselineItem]
	PartAllocations      AssetRepository[PartAllocation]
	PartPlacements       AssetRepository[PartPlacement]
	AssetActions         AssetRepository[AssetAction]
	PartMovements        AssetRepository[PartMovement]
	PartIdentityEvents   AssetRepository[PartIdentityEvent]
	AssetAttachments     ReceivingAttachmentRepository
	AssetCommandReceipts AssetRepository[AssetCommandReceipt]
	ComponentModels      AssetRepository[CatalogModel]
	ComponentRevisions   AssetRepository[CatalogRevision]
	Companies            AssetRepository[Company]
	Warehouses           AssetRepository[Warehouse]
	Shelves              AssetRepository[Shelf]
	Bins                 AssetRepository[Bin]
}
type ReceivingUnitOfWork interface {
	Read(context.Context, func(ReceivingRepositories) error) error
	Write(context.Context, string, func(ReceivingRepositories) error) error
}
type ReceiptResult struct {
	ReceiptID           uuid.UUID `json:"receipt_id"`
	State               string    `json:"state"`
	Version             int64     `json:"version"`
	CompletedAt         time.Time `json:"completed_at"`
	ActionID            uuid.UUID `json:"action_id"`
	AcceptedDeviceCount int       `json:"accepted_device_count"`
	RejectedDeviceCount int       `json:"rejected_device_count"`
	CreatedPartCount    int       `json:"created_part_count"`
	PurchaseBatchID     uuid.UUID `json:"purchase_batch_id"`
	OrderVersion        int64     `json:"order_version"`
	ResultItemsURL      string    `json:"result_items_url"`
}
type ReceivingError struct {
	Reason         string         `json:"reason"`
	Message        string         `json:"-"`
	CurrentVersion int64          `json:"current_version,omitempty"`
	Fields         []ReceiptIssue `json:"fields,omitempty"`
}

func (e *ReceivingError) Error() string { return e.Message }

type ReceiptIssue struct {
	Reason      string     `json:"reason"`
	ItemID      *uuid.UUID `json:"item_id,omitempty"`
	ComponentID *uuid.UUID `json:"component_id,omitempty"`
	Field       string     `json:"field"`
	Message     string     `json:"message"`
}
type ReceiptPreview struct {
	ReceiptID      uuid.UUID      `json:"receipt_id"`
	CheckedVersion int64          `json:"checked_version"`
	CanComplete    bool           `json:"can_complete"`
	Errors         []ReceiptIssue `json:"errors"`
	Warnings       []ReceiptIssue `json:"warnings"`
	Summary        ReceiptResult  `json:"summary"`
}

// ReceivingCall is an authenticated transport request. Input is decoded into a
// per-operation DTO before business rules run; RawBody is never persisted as facts.
type ReceivingCall struct {
	Operation                        string
	ActorID                          uuid.UUID
	ID, ChildID, ItemID, ComponentID uuid.UUID
	Key                              string
	Body                             jsontext.Value
	Query                            map[string]string
	File                             []byte
	Filename                         string
	CanReadReceipt, CanReadDevice    bool
}
type ReceivingFile struct {
	Content []byte
	MIME    string
}
type ReceivingService interface {
	Execute(context.Context, ReceivingCall) (any, error)
}

type ReceivingAttachmentRepository interface {
	AssetRepository[AssetAttachment]
	Content(context.Context, uuid.UUID) ([]byte, error)
}
