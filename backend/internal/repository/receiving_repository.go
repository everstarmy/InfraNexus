package repository

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"infranexus/internal/domain"
)

type receivingUnitOfWork struct{ db *gorm.DB }

func NewReceivingUnitOfWork(db *gorm.DB) domain.ReceivingUnitOfWork {
	return &receivingUnitOfWork{db: db}
}
func (u *receivingUnitOfWork) Read(ctx context.Context, fn func(domain.ReceivingRepositories) error) error {
	return u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock_shared(738401, 2)").Error; err != nil {
			return err
		}
		return fn(receivingRepositories(tx))
	})
}
func (u *receivingUnitOfWork) Write(ctx context.Context, key string, fn func(domain.ReceivingRepositories) error) error {
	return u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Coordinate with foundation edits before taking receiving aggregate locks.
		// Receiving commands serialize in this first release; no external IO is
		// performed under these locks. Read transactions use a shared lock.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(738401, 1)").Error; err != nil {
			return err
		}
		if err := tx.Exec("SELECT pg_advisory_xact_lock(738401, 2)").Error; err != nil {
			return err
		}
		// Serialize duplicate command keys before their first row exists. Hash
		// collisions only reduce concurrency; they cannot change identity.
		if key != "" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", key).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec("SELECT pg_advisory_xact_lock_shared(738401, 2)").Error; err != nil {
			return err
		}
		return fn(receivingRepositories(tx))
	})
}
func receivingRepositories(db *gorm.DB) domain.ReceivingRepositories {
	return domain.ReceivingRepositories{
		CatalogModels:        newAssetRepository[domain.CatalogModel](db, "ast_device_model"),
		CatalogRevisions:     newAssetRepository[domain.CatalogRevision](db, "ast_device_model_revision"),
		ModelSlots:           newAssetRepository[domain.ModelSlot](db, "ast_model_slot_template"),
		ModelPorts:           newAssetRepository[domain.ModelPort](db, "ast_model_port_template"),
		ModelComponents:      newAssetRepository[domain.ModelComponent](db, "ast_model_standard_component"),
		ModelCompatibilitys:  newAssetRepository[domain.ModelCompatibility](db, "part_compatibility"),
		ArrivalOrders:        newAssetRepository[domain.ArrivalOrder](db, "ast_purchase_batch"),
		ArrivalLines:         newAssetRepository[domain.ArrivalLine](db, "ast_purchase_line"),
		ArrivalComponents:    newAssetRepository[domain.ArrivalComponent](db, "ast_purchase_line_component"),
		Receipts:             newAssetRepository[domain.Receipt](db, "ast_receipt"),
		ReceiptItems:         newAssetRepository[domain.ReceiptItem](db, "ast_receipt_item"),
		ReceiptComponents:    newAssetRepository[domain.ReceiptComponent](db, "ast_receipt_component"),
		CustodyLocations:     newAssetRepository[domain.CustodyLocation](db, "ast_custody_location"),
		AssetObjects:         newAssetRepository[domain.AssetObject](db, "res_object"),
		AssetDevices:         newAssetRepository[domain.AssetDevice](db, "ast_device"),
		AssetParts:           newAssetRepository[domain.AssetPart](db, "part_item"),
		ReceiptBaselines:     newAssetRepository[domain.ReceiptBaseline](db, "ast_receipt_baseline"),
		ReceiptBaselineItems: newAssetRepository[domain.ReceiptBaselineItem](db, "ast_receipt_baseline_item"),
		PartAllocations:      newAssetRepository[domain.PartAllocation](db, "part_slot_allocation"),
		PartPlacements:       newAssetRepository[domain.PartPlacement](db, "part_current_placement"),
		AssetActions:         newAssetRepository[domain.AssetAction](db, "ast_asset_action"),
		PartMovements:        newAssetRepository[domain.PartMovement](db, "part_movement_event"),
		PartIdentityEvents:   newAssetRepository[domain.PartIdentityEvent](db, "part_identity_event"),
		AssetAttachments:     newReceivingAttachmentRepository(db),
		AssetCommandReceipts: newAssetRepository[domain.AssetCommandReceipt](db, "ast_command_receipt"),
		ComponentModels:      newAssetRepository[domain.CatalogModel](db, "part_model"),
		ComponentRevisions:   newAssetRepository[domain.CatalogRevision](db, "part_model_revision"),
		Companies:            newAssetRepository[domain.Company](db, "org_company"),
		Warehouses:           newAssetRepository[domain.Warehouse](db, "dc_warehouse"),
		Shelves:              newAssetRepository[domain.Shelf](db, "dc_shelf"),
		Bins:                 newAssetRepository[domain.Bin](db, "dc_bin"),
	}
}

type assetRepository[T any] struct {
	db      *gorm.DB
	table   string
	columns map[string]bool
}

func newAssetRepository[T any](db *gorm.DB, table string) domain.AssetRepository[T] {
	stmt := &gorm.Statement{DB: db}
	_ = stmt.Parse(new(T))
	cols := make(map[string]bool, len(stmt.Schema.Fields))
	for _, f := range stmt.Schema.Fields {
		cols[f.DBName] = true
	}
	return &assetRepository[T]{db: db, table: table, columns: cols}
}
func (r *assetRepository[T]) Get(ctx context.Context, id uuid.UUID, lock bool) (*T, error) {
	var out T
	q := r.db.WithContext(ctx).Table(r.table)
	if r.table == "core_attachment" {
		q = q.Omit("content")
	}
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := q.First(&out, "id = ?", id).Error
	return &out, err
}
func (r *assetRepository[T]) List(ctx context.Context, in domain.AssetQuery) (domain.AssetRows[T], error) {
	out := domain.AssetRows[T]{Items: []T{}, Page: in.Page, PageSize: in.PageSize}
	q := r.db.WithContext(ctx).Table(r.table).Model(new(T))
	for _, f := range in.Filters {
		filtered, handled, err := assetDerivedFilter(q, r.table, f)
		if err != nil {
			return out, err
		}
		if handled {
			q = filtered
			continue
		}
		if !r.columns[f.Field] {
			return out, fmt.Errorf("unsupported asset filter")
		}
		if f.Value == nil {
			q = q.Where(clause.Eq{Column: f.Field, Value: nil})
		} else {
			q = q.Where(clause.Eq{Column: f.Field, Value: f.Value})
		}
	}
	if in.CreatedFrom != nil {
		q = q.Where("created_at >= ?", *in.CreatedFrom)
	}
	if in.CreatedTo != nil {
		q = q.Where("created_at <= ?", *in.CreatedTo)
	}
	if in.Search != "" {
		var expr []clause.Expression
		for _, col := range []string{"name", "number", "serial_number", "asset_code", "internal_code", "part_no", "model_name"} {
			if r.columns[col] {
				expr = append(expr, clause.Like{Column: col, Value: "%" + strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(in.Search, "\\", "\\\\"), "%", "\\%"), "_", "\\_") + "%"})
			}
		}
		if len(expr) > 0 {
			q = q.Where(clause.Or(expr...))
		}
	}
	if err := q.Count(&out.Total).Error; err != nil {
		return out, err
	}
	if r.columns["recorded_at"] {
		q = q.Order("recorded_at DESC")
	} else {
		q = q.Order("created_at DESC")
	}
	q = q.Order("id DESC")
	if in.Lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if in.PageSize > 0 {
		q = q.Limit(in.PageSize).Offset((max(in.Page, 1) - 1) * in.PageSize)
	}
	if r.table == "core_attachment" {
		q = q.Omit("content")
	}
	err := q.Find(&out.Items).Error
	return out, err
}
func (r *assetRepository[T]) Create(ctx context.Context, in *T) error {
	// All registered records expose ID. IDs are generated before related records,
	// never from a sequence or a serial-number placeholder.
	v := reflect.ValueOf(in).Elem()
	f := v.FieldByName("ID")
	if f.IsValid() && f.Interface().(uuid.UUID) == uuid.Nil {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		f.Set(reflect.ValueOf(id))
	}
	return r.db.WithContext(ctx).Table(r.table).Create(in).Error
}
func (r *assetRepository[T]) Save(ctx context.Context, in *T) error {
	v := reflect.ValueOf(in).Elem()
	id := v.FieldByName("ID").Interface()
	if f := v.FieldByName("UpdatedAt"); f.IsValid() {
		f.Set(reflect.ValueOf(time.Now().UTC()))
	}
	q := r.db.WithContext(ctx).Table(r.table).Where("id = ?", id).Select("*").Omit("id", "created_at")
	if r.table == "core_attachment" {
		q = q.Omit("id", "created_at", "content")
	}
	result := q.Updates(in)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
func (r *assetRepository[T]) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Table(r.table).Where("id = ?", id).Delete(new(T)).Error
}
