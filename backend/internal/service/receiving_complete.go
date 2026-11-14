package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"

	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
)

func (s *receivingService) previewReceipt(ctx context.Context, r domain.ReceivingRepositories, rec domain.Receipt, order domain.ArrivalOrder) (domain.ReceiptPreview, error) {
	out := domain.ReceiptPreview{ReceiptID: rec.ID, CheckedVersion: rec.Version, Errors: []domain.ReceiptIssue{}, Warnings: []domain.ReceiptIssue{}}
	issue := func(item, part *uuid.UUID, field, reason, msg string) {
		out.Errors = append(out.Errors, domain.ReceiptIssue{ItemID: item, ComponentID: part, Field: field, Reason: reason, Message: msg})
	}
	capture := func(e error, item, part *uuid.UUID, field string) error {
		if e == nil {
			return nil
		}
		if v, ok := errors.AsType[*domain.ReceivingError](e); ok {
			issue(item, part, field, v.Reason, v.Message)
			return nil
		}
		return e
	}
	if rec.State != "draft" || order.State != "open" {
		issue(nil, nil, "state", "STATE_CONFLICT", "验收单或到货单状态已变化")
	}
	if e := capture(assetCompany(ctx, r, order.SupplierID, 2), nil, nil, "supplier_id"); e != nil {
		return out, e
	}
	items, e := receiptItems(ctx, r, rec.ID)
	if e != nil {
		return out, e
	}
	if len(items) == 0 || len(items) > 50 {
		issue(nil, nil, "items", "LIMIT_EXCEEDED", "验收项数量须为 1～50")
	}
	quantities := map[uuid.UUID]int{}
	partSerials := map[string]bool{}
	deviceSerials := map[string]bool{}
	allParts := 0
	for _, item := range items {
		id := item.ID
		if item.InspectionResult == "pending" {
			issue(&id, nil, "inspection_result", "INSPECTION_PENDING", "尚未完成验收判定")
			continue
		}
		if item.SerialNumber == nil {
			issue(&id, nil, "serial_number", "VALIDATION_FAILED", "设备序列号必填")
		}
		if !assetTimeValid(item.InspectedAt) {
			issue(&id, nil, "inspected_at", "VALIDATION_FAILED", "现场核验时间缺失或晚于当前时间")
		}
		photos, e := r.AssetAttachments.List(ctx, assetQ("receipt_item_id", id))
		if e != nil {
			return out, e
		}
		if photos.Total == 0 {
			issue(&id, nil, "photos", "EVIDENCE_REQUIRED", "至少上传一张验收图片")
		}
		if item.InspectionResult == "reject" {
			out.Summary.RejectedDeviceCount++
			if item.RejectReason == nil || strings.TrimSpace(*item.RejectReason) == "" {
				issue(&id, nil, "reject_reason", "VALIDATION_FAILED", "拒收原因必填")
			}
			continue
		}
		out.Summary.AcceptedDeviceCount++
		quantities[item.PurchaseLineID]++
		m, _, e := catalogPublished(ctx, r, item.DeviceModelRevisionID, false)
		if e != nil {
			if e = capture(e, &id, nil, "device_model_revision_id"); e != nil {
				return out, e
			}
			continue
		}
		if item.NormalizedSN != nil {
			key := m.ManufacturerID.String() + ":" + *item.NormalizedSN
			if deviceSerials[key] {
				issue(&id, nil, "serial_number", "SERIAL_CONFLICT", "本批设备序列号重复")
			}
			deviceSerials[key] = true
			q := assetQ("manufacturer_id", m.ManufacturerID)
			q.Filters = append(q.Filters, domain.AssetFilter{Field: "normalized_sn", Value: *item.NormalizedSN})
			p, e := r.AssetDevices.List(ctx, q)
			if e != nil {
				return out, e
			}
			if p.Total > 0 {
				issue(&id, nil, "serial_number", "SERIAL_CONFLICT", "设备序列号已入库")
			}
		}
		if item.CustodyLocationID == nil {
			issue(&id, nil, "location", "LOCATION_REQUIRED", "请填写库房位置")
		} else {
			loc, e := assetLocationView(ctx, r, *item.CustodyLocationID)
			if e != nil {
				return out, e
			}
			_, e = assetLocation(ctx, r, loc)
			if e = capture(e, &id, nil, "location"); e != nil {
				return out, e
			}
		}
		if !item.ConfigurationConfirmed {
			issue(&id, nil, "configuration_confirmed", "CONFIGURATION_UNCONFIRMED", "请确认实际组件配置")
		}
		parts, e := assetAll(ctx, r.ReceiptComponents, "receipt_item_id", id)
		if e != nil {
			return out, e
		}
		out.Summary.CreatedPartCount += len(parts)
		allParts += len(parts)
		actual := map[string]int{}
		for _, p := range parts {
			pid := p.ID
			pm, _, e := catalogPublished(ctx, r, p.PartModelRevisionID, true)
			if e != nil {
				if e = capture(e, &id, &pid, "part_model_revision_id"); e != nil {
					return out, e
				}
				continue
			}
			if p.InitialPlacement == "installed" {
				if e = capture(componentCompatible(ctx, r, item.DeviceModelRevisionID, p.PartModelRevisionID, p.SlotKey), &id, &pid, "slot_key"); e != nil {
					return out, e
				}
			} else if p.CustodyLocationID != nil {
				loc, e := assetLocationView(ctx, r, *p.CustodyLocationID)
				if e != nil {
					return out, e
				}
				_, e = assetLocation(ctx, r, loc)
				if e = capture(e, &id, &pid, "location"); e != nil {
					return out, e
				}
			}
			if p.NormalizedSN == nil {
				out.Warnings = append(out.Warnings, domain.ReceiptIssue{ItemID: &id, ComponentID: &pid, Field: "serial_number", Reason: "PART_SERIAL_MISSING", Message: "组件序列号可后补"})
			} else {
				key := pm.ManufacturerID.String() + ":" + *p.NormalizedSN
				if partSerials[key] {
					issue(&id, &pid, "serial_number", "SERIAL_CONFLICT", "本批组件序列号重复")
				}
				partSerials[key] = true
				q := assetQ("manufacturer_id", pm.ManufacturerID)
				q.Filters = append(q.Filters, domain.AssetFilter{Field: "normalized_sn", Value: *p.NormalizedSN})
				found, e := r.AssetParts.List(ctx, q)
				if e != nil {
					return out, e
				}
				if found.Total > 0 {
					issue(&id, &pid, "serial_number", "SERIAL_CONFLICT", "组件序列号已入库")
				}
			}
			key := p.PartModelRevisionID.String() + ":" + p.InitialPlacement + ":"
			if p.SlotKey != nil {
				key += *p.SlotKey
			}
			actual[key]++
		}
		planned, e := assetAll(ctx, r.ArrivalComponents, "purchase_line_id", item.PurchaseLineID)
		if e != nil {
			return out, e
		}
		for _, p := range planned {
			key := p.PartModelRevisionID.String() + ":installed:"
			if p.SlotKey != nil {
				key += *p.SlotKey
			}
			actual[key] -= p.Quantity
		}
		different := false
		for _, n := range actual {
			different = different || n != 0
		}
		if different && (item.DifferenceReason == nil || strings.TrimSpace(*item.DifferenceReason) == "") {
			issue(&id, nil, "difference_reason", "DIFFERENCE_REASON_REQUIRED", "实际配置与计划不同，请填写差异说明")
		}
	}
	if allParts > 4096 {
		issue(nil, nil, "components", "LIMIT_EXCEEDED", "单批组件数量超限")
	}
	for id, n := range quantities {
		line, e := r.ArrivalLines.Get(ctx, id, true)
		if e != nil {
			return out, e
		}
		if n > line.PlannedQuantity-line.AcceptedQuantity {
			issue(nil, nil, "quantity", "ORDER_QUANTITY_EXCEEDED", "验收通过数量超过剩余计划")
		}
	}
	out.CanComplete = len(out.Errors) == 0
	return out, nil
}
func (s *receivingService) completeReceipt(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall, rec *domain.Receipt, order *domain.ArrivalOrder) (any, error) {
	preview, e := s.previewReceipt(ctx, r, *rec, *order)
	if e != nil {
		return nil, e
	}
	if !preview.CanComplete {
		return nil, &domain.ReceivingError{Reason: preview.Errors[0].Reason, Message: "验收内容未通过校验", Fields: preview.Errors}
	}
	now := time.Now().UTC()
	summaryJSON, e := assetJSON(preview.Summary)
	if e != nil {
		return nil, e
	}
	action := domain.AssetAction{Kind: "receipt_accept", ResourceID: rec.ID, ReceiptID: &rec.ID, ActorUserID: c.ActorID, RequestID: requestmeta.RequestID(ctx), Before: assetNullJSON(), After: summaryJSON}
	if e = r.AssetActions.Create(ctx, &action); e != nil {
		return nil, e
	}
	items, e := receiptItems(ctx, r, rec.ID)
	if e != nil {
		return nil, e
	}
	counts := map[uuid.UUID]int{}
	for _, item := range items {
		if item.InspectionResult != "pass" {
			continue
		}
		counts[item.PurchaseLineID]++
		model, rev, e := catalogPublished(ctx, r, item.DeviceModelRevisionID, false)
		if e != nil {
			return nil, e
		}
		mfr, e := r.Companies.Get(ctx, model.ManufacturerID, false)
		if e != nil {
			return nil, e
		}
		loc, e := assetLocationView(ctx, r, *item.CustodyLocationID)
		if e != nil {
			return nil, e
		}
		object := domain.AssetObject{ObjectType: "device"}
		if e = r.AssetObjects.Create(ctx, &object); e != nil {
			return nil, e
		}
		device := domain.AssetDevice{AssetCode: assetNumber("DEV"), DeviceModelRevisionID: rev.ID, ManufacturerID: model.ManufacturerID, SerialNumber: *item.SerialNumber, NormalizedSN: *item.NormalizedSN, SupplierID: order.SupplierID, SourceReceiptItemID: item.ID, LifecycleState: "in_stock", CurrentCustodyLocationID: *item.CustodyLocationID, ConfigurationVersion: 1}
		device.ID = object.ID
		if e = r.AssetDevices.Create(ctx, &device); e != nil {
			return nil, e
		}
		baseline := domain.ReceiptBaseline{DeviceID: device.ID, ReceiptItemID: item.ID, DeviceModelRevisionID: rev.ID, Snapshot: datatypes.NewJSONType(domain.AssetSnapshot{SchemaVersion: 1, Name: model.Name, ManufacturerName: mfr.Name, ModelRevisionID: rev.ID, SerialNumber: item.SerialNumber, Spec: rev.Spec.Data(), Location: loc}), AcceptedAt: now, AcceptedBy: c.ActorID, ActionID: action.ID}
		if e = r.ReceiptBaselines.Create(ctx, &baseline); e != nil {
			return nil, e
		}
		photos, e := assetAll(ctx, r.AssetAttachments, "receipt_item_id", item.ID)
		if e != nil {
			return nil, e
		}
		for _, photo := range photos {
			photo.BaselineID = &baseline.ID
			if e = r.AssetAttachments.Save(ctx, &photo); e != nil {
				return nil, e
			}
		}
		parts, e := assetAll(ctx, r.ReceiptComponents, "receipt_item_id", item.ID)
		if e != nil {
			return nil, e
		}
		for _, p := range parts {
			pm, pr, e := catalogPublished(ctx, r, p.PartModelRevisionID, true)
			if e != nil {
				return nil, e
			}
			manufacturer, e := r.Companies.Get(ctx, pm.ManufacturerID, false)
			if e != nil {
				return nil, e
			}
			obj := domain.AssetObject{ObjectType: "component"}
			if e = r.AssetObjects.Create(ctx, &obj); e != nil {
				return nil, e
			}
			part := domain.AssetPart{InternalCode: assetNumber("PART"), PartModelRevisionID: pr.ID, ManufacturerID: pm.ManufacturerID, SerialNumber: p.SerialNumber, NormalizedSN: p.NormalizedSN, SourceReceiptComponentID: p.ID, QualityState: "usable"}
			part.ID = obj.ID
			if e = r.AssetParts.Create(ctx, &part); e != nil {
				return nil, e
			}
			snapshot := domain.AssetSnapshot{SchemaVersion: 1, Name: pm.Name, ManufacturerName: manufacturer.Name, ModelRevisionID: pr.ID, SerialNumber: p.SerialNumber, Spec: pr.Spec.Data()}
			if p.CustodyLocationID != nil {
				snapshot.Location, e = assetLocationView(ctx, r, *p.CustodyLocationID)
				if e != nil {
					return nil, e
				}
			}
			b := domain.ReceiptBaselineItem{BaselineID: baseline.ID, PartItemID: part.ID, PartModelRevisionID: pr.ID, Snapshot: datatypes.NewJSONType(snapshot), SerialNumberAtReceipt: p.SerialNumber, OriginalSlotKey: p.SlotKey, OriginalPlacement: p.InitialPlacement}
			if e = r.ReceiptBaselineItems.Create(ctx, &b); e != nil {
				return nil, e
			}
			place := domain.PartPlacement{PartItemID: part.ID, Kind: p.InitialPlacement, CustodyLocationID: p.CustodyLocationID, LastActionID: action.ID}
			event := domain.PartMovement{PartItemID: part.ID, ActionID: action.ID, RecordedAt: now, EffectiveAt: item.InspectedAt, SlotKey: p.SlotKey}
			if p.InitialPlacement == "installed" {
				allocation := domain.PartAllocation{PartItemID: part.ID, DeviceID: device.ID, SlotKey: p.SlotKey, RecordedAt: now, StartActionID: action.ID}
				if e = r.PartAllocations.Create(ctx, &allocation); e != nil {
					return nil, e
				}
				place.AllocationID = &allocation.ID
				event.EventType = "receipt_installed"
				event.ToDeviceID = &device.ID
			} else {
				event.EventType = "receipt_stored"
				event.ToCustodyLocationID = p.CustodyLocationID
			}
			if e = r.PartPlacements.Create(ctx, &place); e != nil {
				return nil, e
			}
			if e = r.PartMovements.Create(ctx, &event); e != nil {
				return nil, e
			}
		}
	}
	lines, e := assetAll(ctx, r.ArrivalLines, "purchase_batch_id", order.ID)
	if e != nil {
		return nil, e
	}
	fulfilled := true
	for _, line := range lines {
		line.AcceptedQuantity += counts[line.ID]
		fulfilled = fulfilled && line.AcceptedQuantity == line.PlannedQuantity
		if counts[line.ID] > 0 {
			line.Version++
			if e = r.ArrivalLines.Save(ctx, &line); e != nil {
				return nil, e
			}
		}
	}
	order.Version++
	if fulfilled {
		order.State = "completed"
		order.CompletedAt = &now
	}
	if e = r.ArrivalOrders.Save(ctx, order); e != nil {
		return nil, e
	}
	rec.State = "completed"
	rec.CompletedAt = &now
	rec.CompletedBy = &c.ActorID
	rec.Version++
	result := preview.Summary
	result.ReceiptID = rec.ID
	result.State = rec.State
	result.Version = rec.Version
	result.CompletedAt = now
	result.ActionID = action.ID
	result.PurchaseBatchID = order.ID
	result.OrderVersion = order.Version
	result.ResultItemsURL = fmt.Sprintf("/api/v1/receipts/%s/result/items", rec.ID)
	rec.Result = datatypes.NewJSONType(result)
	if e = r.Receipts.Save(ctx, rec); e != nil {
		return nil, e
	}
	return result, nil
}

type receiptResultItem struct {
	ReceiptItemID    uuid.UUID  `json:"receipt_item_id"`
	InspectionResult string     `json:"inspection_result"`
	DeviceID         *uuid.UUID `json:"device_id"`
	BaselineID       *uuid.UUID `json:"baseline_id"`
	PartCount        int64      `json:"part_count"`
}

func (s *receivingService) receiptResultItems(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall, rec domain.Receipt) (any, error) {
	if rec.State != "completed" {
		return nil, assetErr("STATE_CONFLICT", "验收尚未完成")
	}
	q, e := assetPage(c)
	if e != nil {
		return nil, e
	}
	q.Filters = []domain.AssetFilter{{Field: "receipt_id", Value: rec.ID}}
	p, e := r.ReceiptItems.List(ctx, q)
	if e != nil {
		return nil, e
	}
	out := domain.AssetRows[receiptResultItem]{Items: []receiptResultItem{}, Total: p.Total, Page: p.Page, PageSize: p.PageSize}
	for _, item := range p.Items {
		v := receiptResultItem{ReceiptItemID: item.ID, InspectionResult: item.InspectionResult}
		if item.InspectionResult == "pass" {
			d, e := assetOnly(ctx, r.AssetDevices, "source_receipt_item_id", item.ID)
			if e != nil {
				return nil, e
			}
			b, e := assetOnly(ctx, r.ReceiptBaselines, "device_id", d.ID)
			if e != nil {
				return nil, e
			}
			parts, e := r.ReceiptBaselineItems.List(ctx, assetQ("baseline_id", b.ID))
			if e != nil {
				return nil, e
			}
			v.DeviceID = &d.ID
			v.BaselineID = &b.ID
			v.PartCount = parts.Total
		}
		out.Items = append(out.Items, v)
	}
	return out, nil
}
