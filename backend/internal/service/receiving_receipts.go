package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"

	"infranexus/internal/domain"
)

type receiptCreateInput struct {
	PurchaseBatchID uuid.UUID `json:"purchase_batch_id"`
	Note            string    `json:"note"`
}
type receiptItemCreate struct {
	ExpectedVersion     int64     `json:"expected_version"`
	PurchaseLineID      uuid.UUID `json:"purchase_line_id"`
	SerialNumber        *string   `json:"serial_number"`
	ConfigurationSource string    `json:"configuration_source"`
}
type receiptItemEdit struct {
	SerialNumber           *string               `json:"serial_number"`
	Location               *domain.AssetLocation `json:"location"`
	InspectionResult       string                `json:"inspection_result"`
	InspectedAt            *time.Time            `json:"inspected_at"`
	DifferenceReason       *string               `json:"difference_reason"`
	RejectReason           *string               `json:"reject_reason"`
	ConfigurationConfirmed bool                  `json:"configuration_confirmed"`
}
type receiptPartUnit struct {
	SerialNumber *string `json:"serial_number"`
	SlotKey      *string `json:"slot_key"`
}
type receiptPartCreate struct {
	ExpectedVersion     int64                 `json:"expected_version"`
	PartModelRevisionID uuid.UUID             `json:"part_model_revision_id"`
	Quantity            int                   `json:"quantity"`
	InitialPlacement    string                `json:"initial_placement"`
	Location            *domain.AssetLocation `json:"location"`
	Units               []receiptPartUnit     `json:"units"`
}
type receiptPartEdit struct {
	SerialNumber     *string               `json:"serial_number"`
	SlotKey          *string               `json:"slot_key"`
	InitialPlacement string                `json:"initial_placement"`
	Location         *domain.AssetLocation `json:"location"`
}
type receiptItemView struct {
	domain.ReceiptItem
	ReceiptVersion int64                 `json:"receipt_version"`
	Location       *domain.AssetLocation `json:"location"`
}
type receiptWriteResult struct {
	Item           any   `json:"item,omitempty"`
	Items          any   `json:"items,omitempty"`
	ReceiptVersion int64 `json:"receipt_version"`
}

func receiptBump(ctx context.Context, r domain.ReceivingRepositories, v *domain.Receipt) error {
	v.Version++
	return r.Receipts.Save(ctx, v)
}
func receiptItemDetails(ctx context.Context, r domain.ReceivingRepositories, receipt *domain.Receipt, item domain.ReceiptItem) (receiptItemView, error) {
	out := receiptItemView{ReceiptItem: item, ReceiptVersion: receipt.Version}
	if item.CustodyLocationID != nil {
		v, e := assetLocationView(ctx, r, *item.CustodyLocationID)
		if e != nil {
			return out, e
		}
		out.Location = v
	}
	return out, nil
}
func receiptItems(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID) ([]domain.ReceiptItem, error) {
	return assetAll(ctx, r.ReceiptItems, "receipt_id", id)
}
func receiptComponentCount(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID) (int, error) {
	items, e := receiptItems(ctx, r, id)
	if e != nil {
		return 0, e
	}
	total := 0
	for _, i := range items {
		p, e := r.ReceiptComponents.List(ctx, assetQ("receipt_item_id", i.ID))
		if e != nil {
			return 0, e
		}
		total += int(p.Total)
	}
	return total, nil
}
func (s *receivingService) receipt(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall) (any, error) {
	op := strings.TrimPrefix(c.Operation, "receipt.")
	if op == "list" {
		q, e := assetFilterQuery(c, "state", "purchase_batch_id")
		if e != nil {
			return nil, e
		}
		rows, e := r.Receipts.List(ctx, q)
		if e != nil {
			return nil, e
		}
		out := domain.AssetRows[receiptView]{Items: []receiptView{}, Total: rows.Total, Page: rows.Page, PageSize: rows.PageSize}
		for _, rec := range rows.Items {
			v, e := receiptDetails(ctx, r, rec)
			if e != nil {
				return nil, e
			}
			out.Items = append(out.Items, v)
		}
		return out, nil
	}
	if op == "create" {
		in, e := assetDecode[receiptCreateInput](c.Body)
		if e != nil {
			return nil, e
		}
		order, e := r.ArrivalOrders.Get(ctx, in.PurchaseBatchID, true)
		if e != nil {
			return nil, e
		}
		if order.State != "open" {
			return nil, assetErr("ORDER_NOT_OPEN", "到货单未开放收货")
		}
		v := domain.Receipt{Number: assetNumber("RCV"), PurchaseBatchID: order.ID, State: "draft", Note: in.Note, CreatedBy: c.ActorID, Result: datatypes.NewJSONType(domain.ReceiptResult{})}
		return &v, r.Receipts.Create(ctx, &v)
	}
	// Always acquire the order before the receipt, including child edits. This
	// agrees with complete/cancel and prevents a plan closing beneath a write.
	probe, e := r.Receipts.Get(ctx, c.ID, false)
	if e != nil {
		return nil, e
	}
	write := !assetReadOperation(c.Operation)
	order, e := r.ArrivalOrders.Get(ctx, probe.PurchaseBatchID, write)
	if e != nil {
		return nil, e
	}
	rec, e := r.Receipts.Get(ctx, c.ID, write)
	if e != nil {
		return nil, e
	}
	switch op {
	case "get":
		return receiptDetails(ctx, r, *rec)
	case "history":
		return assetHistory(ctx, r, c)
	case "result":
		if rec.State != "completed" {
			return nil, assetErr("STATE_CONFLICT", "验收尚未完成")
		}
		return rec.Result.Data(), nil
	case "result.items.list":
		return s.receiptResultItems(ctx, r, c, *rec)
	case "items.list":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "receipt_id", Value: rec.ID}}
		return r.ReceiptItems.List(ctx, q)
	case "preview":
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		return s.previewReceipt(ctx, r, *rec, *order)
	}
	if write && (rec.State != "draft" || order.State != "open") {
		reason := "STATE_CONFLICT"
		if rec.State == "completed" {
			reason = "RECEIPT_ALREADY_COMPLETED"
		}
		return nil, assetErr(reason, "验收或到货单不再允许修改")
	}
	switch op {
	case "complete":
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		return s.completeReceipt(ctx, r, c, rec, order)
	case "cancel":
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		if e = assetText(in.Reason, 1024, true); e != nil {
			return nil, e
		}
		rec.State = "canceled"
		rec.CanceledAt = new(time.Now().UTC())
		rec.CancelReason = &in.Reason
		rec.Version++
		return rec, r.Receipts.Save(ctx, rec)
	case "update":
		edit, e := assetDecode[assetEdit](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, edit.ExpectedVersion); e != nil {
			return nil, e
		}
		in, e := assetDecode[struct {
			Note string `json:"note"`
		}](edit.Data)
		if e != nil {
			return nil, e
		}
		if e = assetText(in.Note, 1024, false); e != nil {
			return nil, e
		}
		rec.Note = in.Note
		return rec, receiptBump(ctx, r, rec)
	case "items.create":
		in, e := assetDecode[receiptItemCreate](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		if in.ConfigurationSource != "order" {
			return nil, assetErr("VALIDATION_FAILED", "配置来源必须是到货计划")
		}
		line, e := r.ArrivalLines.Get(ctx, in.PurchaseLineID, false)
		if e != nil {
			return nil, e
		}
		if line.PurchaseBatchID != rec.PurchaseBatchID {
			return nil, assetErr("RESOURCE_NOT_FOUND", "明细不属于该到货单")
		}
		items, e := receiptItems(ctx, r, rec.ID)
		if e != nil {
			return nil, e
		}
		if len(items) >= 50 {
			return nil, assetErr("LIMIT_EXCEEDED", "单批最多 50 台设备")
		}
		if _, _, e = catalogPublished(ctx, r, line.DeviceModelRevisionID, false); e != nil {
			return nil, e
		}
		sn, norm, e := assetSN(in.SerialNumber)
		if e != nil {
			return nil, e
		}
		if e = receiptUniqueSN(ctx, r, items, line.DeviceModelRevisionID, uuid.Nil, norm); e != nil {
			return nil, e
		}
		item := domain.ReceiptItem{ReceiptID: rec.ID, PurchaseLineID: line.ID, DeviceModelRevisionID: line.DeviceModelRevisionID, SerialNumber: sn, NormalizedSN: norm, InspectionResult: "pending"}
		if e = r.ReceiptItems.Create(ctx, &item); e != nil {
			return nil, e
		}
		plans, e := assetAll(ctx, r.ArrivalComponents, "purchase_line_id", line.ID)
		if e != nil {
			return nil, e
		}
		count, e := receiptComponentCount(ctx, r, rec.ID)
		if e != nil {
			return nil, e
		}
		for _, p := range plans {
			count += p.Quantity
			if count > 4096 {
				return nil, assetErr("LIMIT_EXCEEDED", "单批组件数量超限")
			}
			for range p.Quantity {
				v := domain.ReceiptComponent{ReceiptItemID: item.ID, PartModelRevisionID: p.PartModelRevisionID, InitialPlacement: "installed", SlotKey: p.SlotKey}
				if e = r.ReceiptComponents.Create(ctx, &v); e != nil {
					return nil, e
				}
			}
		}
		if e = receiptBump(ctx, r, rec); e != nil {
			return nil, e
		}
		return receiptWriteResult{Item: item, ReceiptVersion: rec.Version}, nil
	}
	item, e := r.ReceiptItems.Get(ctx, c.ItemID, write)
	if e != nil {
		return nil, e
	}
	if item.ReceiptID != rec.ID {
		return nil, assetErr("RESOURCE_NOT_FOUND", "设备条目不属于该验收单")
	}
	switch op {
	case "items.get":
		return receiptItemDetails(ctx, r, rec, *item)
	case "items.update":
		edit, e := assetDecode[assetEdit](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, edit.ExpectedVersion); e != nil {
			return nil, e
		}
		in, e := assetDecode[receiptItemEdit](edit.Data)
		if e != nil {
			return nil, e
		}
		if in.InspectionResult != "pending" && in.InspectionResult != "pass" && in.InspectionResult != "reject" {
			return nil, assetErr("VALIDATION_FAILED", "验收判定无效")
		}
		sn, norm, e := assetSN(in.SerialNumber)
		if e != nil {
			return nil, e
		}
		items, e := receiptItems(ctx, r, rec.ID)
		if e != nil {
			return nil, e
		}
		if e = receiptUniqueSN(ctx, r, items, item.DeviceModelRevisionID, item.ID, norm); e != nil {
			return nil, e
		}
		loc, e := assetLocation(ctx, r, in.Location)
		if e != nil {
			return nil, e
		}
		for _, text := range []*string{in.DifferenceReason, in.RejectReason} {
			if text != nil {
				if e = assetText(*text, 1024, false); e != nil {
					return nil, e
				}
			}
		}
		item.SerialNumber = sn
		item.NormalizedSN = norm
		item.CustodyLocationID = loc
		item.InspectionResult = in.InspectionResult
		item.InspectedAt = in.InspectedAt
		item.DifferenceReason = in.DifferenceReason
		item.RejectReason = in.RejectReason
		item.ConfigurationConfirmed = in.ConfigurationConfirmed
		item.Version++
		if e = r.ReceiptItems.Save(ctx, item); e != nil {
			return nil, e
		}
		if e = receiptBump(ctx, r, rec); e != nil {
			return nil, e
		}
		return receiptWriteResult{Item: item, ReceiptVersion: rec.Version}, nil
	case "items.delete":
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		if e = clearAssetChildren(ctx, r.ReceiptComponents, "receipt_item_id", item.ID, func(v domain.ReceiptComponent) uuid.UUID { return v.ID }); e != nil {
			return nil, e
		}
		if e = clearAssetChildren(ctx, r.AssetAttachments, "receipt_item_id", item.ID, func(v domain.AssetAttachment) uuid.UUID { return v.ID }); e != nil {
			return nil, e
		}
		if e = r.ReceiptItems.Delete(ctx, item.ID); e != nil {
			return nil, e
		}
		if e = receiptBump(ctx, r, rec); e != nil {
			return nil, e
		}
		return receiptWriteResult{ReceiptVersion: rec.Version}, nil
	case "components.list":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "receipt_item_id", Value: item.ID}}
		for _, field := range []string{"serial_status", "kind", "placement_kind"} {
			if value := c.Query[field]; value != "" {
				q.Filters = append(q.Filters, domain.AssetFilter{Field: field, Value: value})
			}
		}
		return r.ReceiptComponents.List(ctx, q)
	case "components.create":
		in, e := assetDecode[receiptPartCreate](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		count, e := receiptComponentCount(ctx, r, rec.ID)
		if e != nil {
			return nil, e
		}
		if in.Quantity < 1 || in.Quantity > 512 || in.Quantity+count > 4096 || in.Units != nil && len(in.Units) != in.Quantity {
			return nil, assetErr("LIMIT_EXCEEDED", "组件数量或逐件明细长度无效")
		}
		if in.Units == nil {
			in.Units = make([]receiptPartUnit, in.Quantity)
		}
		result := make([]domain.ReceiptComponent, 0, in.Quantity)
		for _, u := range in.Units {
			row := domain.ReceiptComponent{ReceiptItemID: item.ID, PartModelRevisionID: in.PartModelRevisionID}
			if e = applyReceiptPart(ctx, r, item, &row, receiptPartEdit{SerialNumber: u.SerialNumber, SlotKey: u.SlotKey, InitialPlacement: in.InitialPlacement, Location: in.Location}); e != nil {
				return nil, e
			}
			if e = r.ReceiptComponents.Create(ctx, &row); e != nil {
				return nil, e
			}
			result = append(result, row)
		}
		item.ConfigurationConfirmed = false
		item.Version++
		if e = r.ReceiptItems.Save(ctx, item); e != nil {
			return nil, e
		}
		if e = receiptBump(ctx, r, rec); e != nil {
			return nil, e
		}
		return receiptWriteResult{Items: result, ReceiptVersion: rec.Version}, nil
	case "photos.list":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "receipt_item_id", Value: item.ID}}
		return r.AssetAttachments.List(ctx, q)
	case "photos.create":
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		if len(c.File) > 10*1024*1024 {
			return nil, assetErr("UPLOAD_TOO_LARGE", "图片超过 10 MiB")
		}
		cfg, format, e := image.DecodeConfig(bytes.NewReader(c.File))
		if e != nil || format != "jpeg" && format != "png" {
			return nil, assetErr("UNSUPPORTED_IMAGE_TYPE", "请上传有效 JPEG 或 PNG 图片")
		}
		if int64(cfg.Width)*int64(cfg.Height) > 40000000 {
			return nil, assetErr("UPLOAD_TOO_LARGE", "图片像素超过限制")
		}
		if _, _, e = image.Decode(bytes.NewReader(c.File)); e != nil {
			return nil, assetErr("UNSUPPORTED_IMAGE_TYPE", "图片内容损坏")
		}
		photos, e := r.AssetAttachments.List(ctx, assetQ("receipt_item_id", item.ID))
		if e != nil {
			return nil, e
		}
		if photos.Total >= 20 {
			return nil, assetErr("LIMIT_EXCEEDED", "每台设备最多 20 张照片")
		}
		sum := sha256.Sum256(c.File)
		a := domain.AssetAttachment{ReceiptItemID: item.ID, OriginalFilename: c.Filename, DetectedMIME: "image/" + format, SizeBytes: int64(len(c.File)), SHA256: hex.EncodeToString(sum[:]), Content: c.File, UploadedBy: c.ActorID}
		if e = r.AssetAttachments.Create(ctx, &a); e != nil {
			return nil, e
		}
		if e = receiptBump(ctx, r, rec); e != nil {
			return nil, e
		}
		return struct {
			domain.AssetAttachment
			ContentURL     string `json:"content_url"`
			ReceiptVersion int64  `json:"receipt_version"`
		}{a, "/api/v1/asset-attachments/" + a.ID.String() + "/content", rec.Version}, nil
	case "photos.delete":
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		a, e := r.AssetAttachments.Get(ctx, c.ComponentID, true)
		if e != nil {
			return nil, e
		}
		if a.ReceiptItemID != item.ID {
			return nil, assetErr("RESOURCE_NOT_FOUND", "图片不属于该验收项")
		}
		if e = r.AssetAttachments.Delete(ctx, a.ID); e != nil {
			return nil, e
		}
		if e = receiptBump(ctx, r, rec); e != nil {
			return nil, e
		}
		return receiptWriteResult{ReceiptVersion: rec.Version}, nil
	}
	part, e := r.ReceiptComponents.Get(ctx, c.ComponentID, true)
	if e != nil {
		return nil, e
	}
	if part.ReceiptItemID != item.ID {
		return nil, assetErr("RESOURCE_NOT_FOUND", "组件不属于该设备条目")
	}
	if op == "components.delete" {
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		if e = r.ReceiptComponents.Delete(ctx, part.ID); e != nil {
			return nil, e
		}
	} else if op == "components.update" {
		edit, e := assetDecode[assetEdit](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(rec.Version, edit.ExpectedVersion); e != nil {
			return nil, e
		}
		in, e := assetDecode[receiptPartEdit](edit.Data)
		if e != nil {
			return nil, e
		}
		if e = applyReceiptPart(ctx, r, item, part, in); e != nil {
			return nil, e
		}
		part.Version++
		if e = r.ReceiptComponents.Save(ctx, part); e != nil {
			return nil, e
		}
	} else {
		return nil, assetErr("RESOURCE_NOT_FOUND", "未知验收操作")
	}
	item.ConfigurationConfirmed = false
	item.Version++
	if e = r.ReceiptItems.Save(ctx, item); e != nil {
		return nil, e
	}
	if e = receiptBump(ctx, r, rec); e != nil {
		return nil, e
	}
	return receiptWriteResult{Item: part, ReceiptVersion: rec.Version}, nil
}
func applyReceiptPart(ctx context.Context, r domain.ReceivingRepositories, item *domain.ReceiptItem, p *domain.ReceiptComponent, in receiptPartEdit) error {
	if in.InitialPlacement != "installed" && in.InitialPlacement != "stored" || in.InitialPlacement == "installed" && in.Location != nil || in.InitialPlacement == "stored" && (in.SlotKey != nil || in.Location == nil) {
		return assetErr("VALIDATION_FAILED", "组件安装或保管位置无效")
	}
	if _, _, e := catalogPublished(ctx, r, p.PartModelRevisionID, true); e != nil {
		return e
	}
	if in.InitialPlacement == "installed" {
		if e := componentCompatible(ctx, r, item.DeviceModelRevisionID, p.PartModelRevisionID, in.SlotKey); e != nil {
			return e
		}
	}
	sn, norm, e := assetSN(in.SerialNumber)
	if e != nil {
		return e
	}
	loc, e := assetLocation(ctx, r, in.Location)
	if e != nil {
		return e
	}
	p.SerialNumber = sn
	p.NormalizedSN = norm
	p.SlotKey = in.SlotKey
	p.InitialPlacement = in.InitialPlacement
	p.CustodyLocationID = loc
	return nil
}
func receiptUniqueSN(ctx context.Context, r domain.ReceivingRepositories, items []domain.ReceiptItem, rev, id uuid.UUID, norm *string) error {
	if norm == nil {
		return nil
	}
	m, _, e := catalogPublished(ctx, r, rev, false)
	if e != nil {
		return e
	}
	for _, v := range items {
		if v.ID == id || v.NormalizedSN == nil || *v.NormalizedSN != *norm {
			continue
		}
		other, _, e := catalogPublished(ctx, r, v.DeviceModelRevisionID, false)
		if e != nil {
			return e
		}
		if other.ManufacturerID == m.ManufacturerID {
			return assetErr("SERIAL_CONFLICT", "该设备序列号已在本验收单中")
		}
	}
	return nil
}
