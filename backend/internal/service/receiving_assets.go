package service

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
)

type partDetail struct {
	domain.AssetPart
	Placement       domain.PartPlacement  `json:"placement"`
	SourceDeviceID  uuid.UUID             `json:"source_device_id"`
	CurrentDeviceID *uuid.UUID            `json:"current_device_id"`
	SlotKey         *string               `json:"slot_key"`
	Location        *domain.AssetLocation `json:"location"`
}

func partDetails(ctx context.Context, r domain.ReceivingRepositories, p domain.AssetPart) (partDetail, error) {
	out := partDetail{AssetPart: p}
	b, e := assetOnly(ctx, r.ReceiptBaselineItems, "part_item_id", p.ID)
	if e != nil {
		return out, e
	}
	base, e := r.ReceiptBaselines.Get(ctx, b.BaselineID, false)
	if e != nil {
		return out, e
	}
	out.SourceDeviceID = base.DeviceID
	place, e := assetOnly(ctx, r.PartPlacements, "part_item_id", p.ID)
	if e != nil {
		return out, e
	}
	out.Placement = *place
	if place.Kind == "installed" {
		a, e := r.PartAllocations.Get(ctx, *place.AllocationID, false)
		if e != nil {
			return out, e
		}
		out.CurrentDeviceID = &a.DeviceID
		out.SlotKey = a.SlotKey
		d, e := r.AssetDevices.Get(ctx, a.DeviceID, false)
		if e != nil {
			return out, e
		}
		out.Location, e = assetLocationView(ctx, r, d.CurrentCustodyLocationID)
		return out, e
	}
	out.Location, e = assetLocationView(ctx, r, *place.CustodyLocationID)
	return out, e
}

type currentConfigurationItem struct {
	domain.PartAllocation
	Part domain.AssetPart `json:"part"`
}
type configurationDifference struct {
	PartItemID      uuid.UUID `json:"part_item_id"`
	Change          string    `json:"change"`
	OriginalSlotKey *string   `json:"original_slot_key"`
	CurrentSlotKey  *string   `json:"current_slot_key"`
}

func (s *receivingService) asset(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall) (any, error) {
	op := strings.TrimPrefix(c.Operation, "asset.")
	if op == "attachments.content" {
		a, e := r.AssetAttachments.Get(ctx, c.ID, false)
		if e != nil {
			return nil, e
		}
		if !c.CanReadReceipt && !(c.CanReadDevice && a.BaselineID != nil) {
			return nil, assetErr("PERMISSION_DENIED", "没有权限查看该验收图片")
		}
		content, e := r.AssetAttachments.Content(ctx, a.ID)
		if e != nil {
			return nil, e
		}
		return domain.ReceivingFile{Content: content, MIME: a.DetectedMIME}, nil
	}
	if op == "devices.list" {
		q, e := assetFilterQuery(c, "manufacturer_id", "supplier_id", "lifecycle_state", "device_model_id", "warehouse_id", "source_receipt_id")
		if e != nil {
			return nil, e
		}
		return r.AssetDevices.List(ctx, q)
	}
	if op == "components.list" {
		q, e := assetFilterQuery(c, "part_model_id", "source_device_id", "current_device_id", "warehouse_id", "placement_kind", "serial_status")
		if e != nil {
			return nil, e
		}
		p, e := r.AssetParts.List(ctx, q)
		if e != nil {
			return nil, e
		}
		out := domain.AssetRows[partDetail]{Items: []partDetail{}, Total: p.Total, Page: p.Page, PageSize: p.PageSize}
		for _, v := range p.Items {
			detail, e := partDetails(ctx, r, v)
			if e != nil {
				return nil, e
			}
			out.Items = append(out.Items, detail)
		}
		return out, nil
	}
	if strings.HasPrefix(op, "components.") {
		p, e := r.AssetParts.Get(ctx, c.ID, !assetReadOperation(c.Operation))
		if e != nil {
			return nil, e
		}
		switch op {
		case "components.get":
			return partDetails(ctx, r, *p)
		case "components.history":
			return assetHistory(ctx, r, c)
		case "components.serial":
			in, e := assetDecode[struct {
				ExpectedVersion int64  `json:"expected_version"`
				SerialNumber    string `json:"serial_number"`
				Reason          string `json:"reason"`
			}](c.Body)
			if e != nil {
				return nil, e
			}
			if e = assetVersion(p.Version, in.ExpectedVersion); e != nil {
				return nil, e
			}
			if e = assetText(in.Reason, 1024, true); e != nil {
				return nil, e
			}
			sn, norm, e := assetSN(&in.SerialNumber)
			if e != nil {
				return nil, e
			}
			if p.NormalizedSN != nil {
				if *p.NormalizedSN == *norm {
					return partDetails(ctx, r, *p)
				}
				return nil, assetErr("SERIAL_CORRECTION_REQUIRED", "已有序列号需通过更正流程处理")
			}
			beforeJSON, e := assetJSON(p)
			if e != nil {
				return nil, e
			}
			afterJSON, e := assetJSON(struct {
				SerialNumber string `json:"serial_number"`
			}{*sn})
			if e != nil {
				return nil, e
			}
			action := domain.AssetAction{Kind: "part_serial_fill", ResourceID: p.ID, ActorUserID: c.ActorID, RequestID: requestmeta.RequestID(ctx), Before: beforeJSON, After: afterJSON}
			if e = r.AssetActions.Create(ctx, &action); e != nil {
				return nil, e
			}
			event := domain.PartIdentityEvent{PartItemID: p.ID, ActionID: action.ID, OldSerialNumber: p.SerialNumber, NewSerialNumber: *sn, Reason: in.Reason, ActorUserID: c.ActorID, RecordedAt: time.Now().UTC()}
			if e = r.PartIdentityEvents.Create(ctx, &event); e != nil {
				return nil, e
			}
			p.SerialNumber = sn
			p.NormalizedSN = norm
			p.Version++
			if e = r.AssetParts.Save(ctx, p); e != nil {
				return nil, e
			}
			detail, e := partDetails(ctx, r, *p)
			return struct {
				partDetail
				IdentityEventID uuid.UUID `json:"identity_event_id"`
			}{detail, event.ID}, e
		}
	}
	d, e := r.AssetDevices.Get(ctx, c.ID, false)
	if e != nil {
		return nil, e
	}
	if raw := c.Query["expected_configuration_version"]; raw != "" {
		v, e := strconv.ParseInt(raw, 10, 64)
		if e != nil {
			return nil, assetErr("VALIDATION_FAILED", "配置版本无效")
		}
		if e = assetVersion(d.ConfigurationVersion, v); e != nil {
			return nil, e
		}
	}
	base, e := assetOnly(ctx, r.ReceiptBaselines, "device_id", d.ID)
	if e != nil {
		return nil, e
	}
	switch op {
	case "devices.get":
		loc, e := assetLocationView(ctx, r, d.CurrentCustodyLocationID)
		return struct {
			domain.AssetDevice
			Location   *domain.AssetLocation `json:"location"`
			BaselineID uuid.UUID             `json:"baseline_id"`
		}{*d, loc, base.ID}, e
	case "devices.history":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "device_history", Value: d.ID}}
		return r.AssetActions.List(ctx, q)
	case "devices.original.get":
		parts, e := r.ReceiptBaselineItems.List(ctx, assetQ("baseline_id", base.ID))
		if e != nil {
			return nil, e
		}
		photos, e := r.AssetAttachments.List(ctx, assetQ("baseline_id", base.ID))
		return struct {
			domain.ReceiptBaseline
			ComponentCount int64                    `json:"component_count"`
			Photos         []domain.AssetAttachment `json:"photos"`
		}{*base, parts.Total, photos.Items}, e
	case "devices.original.items.list":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "baseline_id", Value: base.ID}}
		p, e := r.ReceiptBaselineItems.List(ctx, q)
		if e != nil {
			return nil, e
		}
		type row struct {
			domain.ReceiptBaselineItem
			CurrentIdentity *domain.AssetPart `json:"current_identity,omitempty"`
		}
		out := domain.AssetRows[row]{Items: []row{}, Total: p.Total, Page: p.Page, PageSize: p.PageSize}
		for _, v := range p.Items {
			x := row{ReceiptBaselineItem: v}
			if c.Query["include_current_identity"] == "true" {
				x.CurrentIdentity, e = r.AssetParts.Get(ctx, v.PartItemID, false)
				if e != nil {
					return nil, e
				}
			}
			out.Items = append(out.Items, x)
		}
		return out, nil
	case "devices.current.get", "devices.current.items.list":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "device_id", Value: d.ID}, {Field: "ended_recorded_at", Value: nil}}
		if op == "devices.current.get" {
			q.PageSize = 0
		}
		p, e := r.PartAllocations.List(ctx, q)
		if e != nil {
			return nil, e
		}
		if op == "devices.current.get" {
			unknown := 0
			confirmed := base.AcceptedAt
			for _, v := range p.Items {
				if v.SlotKey == nil {
					unknown++
				}
				if v.RecordedAt.After(confirmed) {
					confirmed = v.RecordedAt
				}
			}
			return struct {
				ConfigurationVersion int64     `json:"configuration_version"`
				ComponentCount       int64     `json:"component_count"`
				UnknownSlotCount     int       `json:"unknown_slot_count"`
				ConfirmedAt          time.Time `json:"confirmed_at"`
			}{d.ConfigurationVersion, p.Total, unknown, confirmed}, nil
		}
		out := domain.AssetRows[currentConfigurationItem]{Items: []currentConfigurationItem{}, Total: p.Total, Page: p.Page, PageSize: p.PageSize}
		for _, v := range p.Items {
			part, e := r.AssetParts.Get(ctx, v.PartItemID, false)
			if e != nil {
				return nil, e
			}
			out.Items = append(out.Items, currentConfigurationItem{PartAllocation: v, Part: *part})
		}
		return out, nil
	case "devices.diff":
		original, e := assetAll(ctx, r.ReceiptBaselineItems, "baseline_id", base.ID)
		if e != nil {
			return nil, e
		}
		q := assetQ("device_id", d.ID)
		q.Filters = append(q.Filters, domain.AssetFilter{Field: "ended_recorded_at", Value: nil})
		current, e := r.PartAllocations.List(ctx, q)
		if e != nil {
			return nil, e
		}
		byID := map[uuid.UUID]domain.PartAllocation{}
		for _, v := range current.Items {
			byID[v.PartItemID] = v
		}
		diff := []configurationDifference{}
		for _, v := range original {
			if v.OriginalPlacement != "installed" {
				continue
			}
			x := configurationDifference{PartItemID: v.PartItemID, OriginalSlotKey: v.OriginalSlotKey, Change: "removed"}
			if a, ok := byID[v.PartItemID]; ok {
				x.CurrentSlotKey = a.SlotKey
				x.Change = "unchanged"
				if !sameAssetSlot(x.OriginalSlotKey, a.SlotKey) {
					x.Change = "moved"
				}
				delete(byID, v.PartItemID)
			}
			diff = append(diff, x)
		}
		for _, v := range current.Items {
			if _, ok := byID[v.PartItemID]; ok {
				diff = append(diff, configurationDifference{PartItemID: v.PartItemID, CurrentSlotKey: v.SlotKey, Change: "added"})
			}
		}
		filtered := []configurationDifference{}
		for _, x := range diff {
			if c.Query["filter"] == "" || c.Query["filter"] == x.Change {
				filtered = append(filtered, x)
			}
		}
		page, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		start := min(len(filtered), (page.Page-1)*page.PageSize)
		end := min(len(filtered), start+page.PageSize)
		return struct {
			domain.AssetRows[configurationDifference]
			BaselineID           uuid.UUID `json:"baseline_id"`
			ConfigurationVersion int64     `json:"configuration_version"`
		}{domain.AssetRows[configurationDifference]{Items: filtered[start:end], Total: int64(len(filtered)), Page: page.Page, PageSize: page.PageSize}, base.ID, d.ConfigurationVersion}, nil
	}
	return nil, assetErr("RESOURCE_NOT_FOUND", "未知资产操作")
}
func sameAssetSlot(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
