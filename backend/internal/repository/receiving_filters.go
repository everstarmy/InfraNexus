package repository

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

// assetDerivedFilter keeps join semantics and SQL exclusively in the repository.
func assetDerivedFilter(q *gorm.DB, table string, f domain.AssetFilter) (*gorm.DB, bool, error) {
	if f.Field == "serial_status" {
		switch f.Value {
		case "missing":
			return q.Where("normalized_sn IS NULL"), true, nil
		case "known":
			return q.Where("normalized_sn IS NOT NULL"), true, nil
		default:
			return q, true, &domain.ReceivingError{Reason: "VALIDATION_FAILED", Message: "序列号筛选无效"}
		}
	}
	switch table {
	case "ast_asset_action":
		if f.Field == "device_history" {
			return q.Where("resource_id = ? OR id IN (SELECT action_id FROM ast_receipt_baseline WHERE device_id = ?)", f.Value, f.Value), true, nil
		}
	case "ast_device":
		switch f.Field {
		case "device_model_id":
			return q.Where("device_model_revision_id IN (SELECT id FROM ast_device_model_revision WHERE model_id = ?)", f.Value), true, nil
		case "source_receipt_id":
			return q.Where("source_receipt_item_id IN (SELECT id FROM ast_receipt_item WHERE receipt_id = ?)", f.Value), true, nil
		case "warehouse_id":
			return q.Where("current_custody_location_id IN ("+receivingWarehouseSQL+")", f.Value, f.Value), true, nil
		}
	case "part_item":
		switch f.Field {
		case "part_model_id":
			return q.Where("part_model_revision_id IN (SELECT id FROM part_model_revision WHERE model_id = ?)", f.Value), true, nil
		case "source_device_id":
			return q.Where("id IN (SELECT i.part_item_id FROM ast_receipt_baseline_item i JOIN ast_receipt_baseline b ON b.id=i.baseline_id WHERE b.device_id = ?)", f.Value), true, nil
		case "current_device_id":
			return q.Where("id IN (SELECT part_item_id FROM part_slot_allocation WHERE device_id = ? AND ended_recorded_at IS NULL)", f.Value), true, nil
		case "placement_kind":
			if f.Value != "installed" && f.Value != "stored" {
				return q, true, &domain.ReceivingError{Reason: "VALIDATION_FAILED", Message: "组件位置筛选无效"}
			}
			return q.Where("id IN (SELECT part_item_id FROM part_current_placement WHERE kind = ?)", f.Value), true, nil
		case "warehouse_id":
			return q.Where("id IN (SELECT p.part_item_id FROM part_current_placement p LEFT JOIN part_slot_allocation a ON a.id=p.allocation_id LEFT JOIN ast_device d ON d.id=a.device_id WHERE COALESCE(p.custody_location_id,d.current_custody_location_id) IN ("+receivingWarehouseSQL+"))", f.Value, f.Value), true, nil
		}
	case "ast_receipt_component":
		switch f.Field {
		case "kind":
			return q.Where("part_model_revision_id IN (SELECT r.id FROM part_model_revision r JOIN part_model m ON m.id=r.model_id WHERE m.kind = ?)", f.Value), true, nil
		case "placement_kind":
			return q.Where("initial_placement = ?", f.Value), true, nil
		}
	}
	return q, false, nil
}

const receivingWarehouseSQL = "SELECT c.id FROM ast_custody_location c WHERE c.warehouse_id = ? OR c.bin_id IN (SELECT b.id FROM dc_bin b JOIN dc_shelf s ON s.id=b.shelf_id WHERE s.warehouse_id = ?)"

type receivingAttachmentRepository struct {
	domain.AssetRepository[domain.AssetAttachment]
	db *gorm.DB
}

func newReceivingAttachmentRepository(db *gorm.DB) domain.ReceivingAttachmentRepository {
	return &receivingAttachmentRepository{AssetRepository: newAssetRepository[domain.AssetAttachment](db, "core_attachment"), db: db}
}
func (r *receivingAttachmentRepository) Content(ctx context.Context, id uuid.UUID) ([]byte, error) {
	var row struct{ Content []byte }
	if e := r.db.WithContext(ctx).Table("core_attachment").Select("content").Where("id = ?", id).Take(&row).Error; e != nil {
		return nil, fmt.Errorf("read receiving evidence: %w", e)
	}
	return row.Content, nil
}
