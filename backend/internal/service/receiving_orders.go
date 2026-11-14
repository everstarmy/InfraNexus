package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"infranexus/internal/domain"
)

type arrivalInput struct {
	Name                string    `json:"name"`
	SupplierID          uuid.UUID `json:"supplier_id"`
	ExternalOrderNo     *string   `json:"external_order_no"`
	ExpectedArrivalDate *string   `json:"expected_arrival_date"`
	Description         string    `json:"description"`
}
type arrivalLineInput struct {
	ExpectedVersion       int64     `json:"expected_version"`
	DeviceModelRevisionID uuid.UUID `json:"device_model_revision_id"`
	PlannedQuantity       int       `json:"planned_quantity"`
	ConfigurationSource   string    `json:"configuration_source"`
	Note                  string    `json:"note"`
}
type arrivalLineEdit struct {
	PlannedQuantity    int             `json:"planned_quantity"`
	Note               string          `json:"note"`
	ExpectedComponents []standardInput `json:"expected_components"`
}
type arrivalLineView struct {
	domain.ArrivalLine
	RemainingQuantity  int                       `json:"remaining_quantity"`
	ExpectedComponents []domain.ArrivalComponent `json:"expected_components"`
}

func arrivalValidate(ctx context.Context, r domain.ReceivingRepositories, in arrivalInput) error {
	if e := assetText(in.Name, 128, true); e != nil {
		return e
	}
	if e := assetText(in.Description, 1024, false); e != nil {
		return e
	}
	if in.ExternalOrderNo != nil {
		if e := assetText(*in.ExternalOrderNo, 128, false); e != nil {
			return e
		}
	}
	if in.ExpectedArrivalDate != nil {
		if _, e := time.Parse("2006-01-02", *in.ExpectedArrivalDate); e != nil {
			return assetErr("VALIDATION_FAILED", "预计日期无效")
		}
	}
	return assetCompany(ctx, r, in.SupplierID, 2)
}
func (s *receivingService) order(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall) (any, error) {
	op := strings.TrimPrefix(c.Operation, "order.")
	if op == "list" {
		q, e := assetFilterQuery(c, "state", "supplier_id")
		if e != nil {
			return nil, e
		}
		rows, e := r.ArrivalOrders.List(ctx, q)
		if e != nil {
			return nil, e
		}
		out := domain.AssetRows[arrivalOrderView]{Items: []arrivalOrderView{}, Total: rows.Total, Page: rows.Page, PageSize: rows.PageSize}
		for _, o := range rows.Items {
			v, e := arrivalDetails(ctx, r, o)
			if e != nil {
				return nil, e
			}
			out.Items = append(out.Items, v)
		}
		return out, nil
	}
	if op == "create" {
		in, e := assetDecode[arrivalInput](c.Body)
		if e != nil {
			return nil, e
		}
		if e = arrivalValidate(ctx, r, in); e != nil {
			return nil, e
		}
		v := domain.ArrivalOrder{Number: assetNumber("ARR"), Name: in.Name, SupplierID: in.SupplierID, ExternalOrderNo: in.ExternalOrderNo, ExpectedArrivalDate: (*domain.AssetDate)(in.ExpectedArrivalDate), Description: in.Description, State: "draft", CreatedBy: c.ActorID}
		return &v, r.ArrivalOrders.Create(ctx, &v)
	}
	order, e := r.ArrivalOrders.Get(ctx, c.ID, !assetReadOperation(c.Operation))
	if e != nil {
		return nil, e
	}
	switch op {
	case "get":
		return arrivalDetails(ctx, r, *order)
	case "history":
		return assetHistory(ctx, r, c)
	case "lines.list":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "purchase_batch_id", Value: order.ID}}
		p, e := r.ArrivalLines.List(ctx, q)
		if e != nil {
			return nil, e
		}
		out := domain.AssetRows[arrivalLineView]{Items: []arrivalLineView{}, Total: p.Total, Page: p.Page, PageSize: p.PageSize}
		for _, v := range p.Items {
			parts, e := assetAll(ctx, r.ArrivalComponents, "purchase_line_id", v.ID)
			if e != nil {
				return nil, e
			}
			out.Items = append(out.Items, arrivalLineView{ArrivalLine: v, RemainingQuantity: v.PlannedQuantity - v.AcceptedQuantity, ExpectedComponents: parts})
		}
		return out, nil
	case "update":
		edit, e := assetDecode[assetEdit](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(order.Version, edit.ExpectedVersion); e != nil {
			return nil, e
		}
		if order.State != "draft" {
			return nil, assetErr("STATE_CONFLICT", "到货计划已冻结")
		}
		in, e := assetDecode[arrivalInput](edit.Data)
		if e != nil {
			return nil, e
		}
		if e = arrivalValidate(ctx, r, in); e != nil {
			return nil, e
		}
		order.Name = in.Name
		order.SupplierID = in.SupplierID
		order.ExternalOrderNo = in.ExternalOrderNo
		order.ExpectedArrivalDate = (*domain.AssetDate)(in.ExpectedArrivalDate)
		order.Description = in.Description
		order.Version++
		return order, r.ArrivalOrders.Save(ctx, order)
	case "lines.create":
		in, e := assetDecode[arrivalLineInput](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(order.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		if order.State != "draft" || in.ConfigurationSource != "model" {
			return nil, assetErr("STATE_CONFLICT", "仅草稿可从型号添加计划")
		}
		if in.PlannedQuantity < 1 || in.PlannedQuantity > 10000 {
			return nil, assetErr("VALIDATION_FAILED", "计划数量须为 1～10000")
		}
		if _, _, e = catalogPublished(ctx, r, in.DeviceModelRevisionID, false); e != nil {
			return nil, e
		}
		all, e := assetAll(ctx, r.ArrivalLines, "purchase_batch_id", order.ID)
		if e != nil {
			return nil, e
		}
		if len(all) >= 1000 {
			return nil, assetErr("LIMIT_EXCEEDED", "单据行数超限")
		}
		next := 1
		for _, l := range all {
			next = max(next, l.LineNo+1)
		}
		line := domain.ArrivalLine{PurchaseBatchID: order.ID, LineNo: next, DeviceModelRevisionID: in.DeviceModelRevisionID, PlannedQuantity: in.PlannedQuantity, Note: in.Note}
		if e = r.ArrivalLines.Create(ctx, &line); e != nil {
			return nil, e
		}
		components, e := assetAll(ctx, r.ModelComponents, "revision_id", line.DeviceModelRevisionID)
		if e != nil {
			return nil, e
		}
		for _, v := range components {
			p := domain.ArrivalComponent{PurchaseLineID: line.ID, PartModelRevisionID: v.PartModelRevisionID, SlotKey: v.SlotKey, Quantity: v.Quantity, Required: v.Required}
			if e = r.ArrivalComponents.Create(ctx, &p); e != nil {
				return nil, e
			}
		}
		order.Version++
		if e = r.ArrivalOrders.Save(ctx, order); e != nil {
			return nil, e
		}
		return struct {
			Line         domain.ArrivalLine `json:"line"`
			OrderVersion int64              `json:"order_version"`
		}{line, order.Version}, nil
	case "lines.update", "lines.delete":
		line, e := r.ArrivalLines.Get(ctx, c.ChildID, true)
		if e != nil {
			return nil, e
		}
		if line.PurchaseBatchID != order.ID {
			return nil, assetErr("RESOURCE_NOT_FOUND", "明细不属于该单据")
		}
		if order.State != "draft" {
			return nil, assetErr("STATE_CONFLICT", "到货计划已冻结")
		}
		var version int64
		var in arrivalLineEdit
		if op == "lines.update" {
			edit, e := assetDecode[assetEdit](c.Body)
			if e != nil {
				return nil, e
			}
			version = edit.ExpectedVersion
			in, e = assetDecode[arrivalLineEdit](edit.Data)
			if e != nil {
				return nil, e
			}
			if in.PlannedQuantity < 1 || in.PlannedQuantity > 10000 || len(in.ExpectedComponents) > 4096 {
				return nil, assetErr("VALIDATION_FAILED", "数量或配置条数无效")
			}
		} else {
			cmd, e := assetCommandInput(c)
			if e != nil {
				return nil, e
			}
			version = cmd.ExpectedVersion
		}
		if e = assetVersion(order.Version, version); e != nil {
			return nil, e
		}
		previous, e := assetAll(ctx, r.ArrivalComponents, "purchase_line_id", line.ID)
		if e != nil {
			return nil, e
		}
		owned := make(map[uuid.UUID]bool, len(previous))
		for _, v := range previous {
			owned[v.ID] = true
		}
		total := 0
		for _, v := range in.ExpectedComponents {
			if v.ID != uuid.Nil && !owned[v.ID] {
				return nil, assetErr("RESOURCE_NOT_FOUND", "计划组件不属于该行")
			}
			total += v.Quantity
			if total > 4096 {
				return nil, assetErr("LIMIT_EXCEEDED", "计划组件总数超过 4096 件")
			}
		}
		if e = clearAssetChildren(ctx, r.ArrivalComponents, "purchase_line_id", line.ID, func(v domain.ArrivalComponent) uuid.UUID { return v.ID }); e != nil {
			return nil, e
		}
		if op == "lines.delete" {
			if e = r.ArrivalLines.Delete(ctx, line.ID); e != nil {
				return nil, e
			}
		} else {
			for _, v := range in.ExpectedComponents {
				if v.Quantity < 1 || v.Quantity > 512 || v.SlotKey != nil && v.Quantity != 1 {
					return nil, assetErr("VALIDATION_FAILED", "组件数量无效")
				}
				if e = componentCompatible(ctx, r, line.DeviceModelRevisionID, v.PartModelRevisionID, v.SlotKey); e != nil {
					return nil, e
				}
				p := domain.ArrivalComponent{PurchaseLineID: line.ID, PartModelRevisionID: v.PartModelRevisionID, SlotKey: v.SlotKey, Quantity: v.Quantity, Required: v.Required}
				p.ID = v.ID
				if e = r.ArrivalComponents.Create(ctx, &p); e != nil {
					return nil, e
				}
			}
			line.PlannedQuantity = in.PlannedQuantity
			line.Note = in.Note
			line.Version++
			if e = r.ArrivalLines.Save(ctx, line); e != nil {
				return nil, e
			}
		}
		order.Version++
		if e = r.ArrivalOrders.Save(ctx, order); e != nil {
			return nil, e
		}
		return struct {
			OrderVersion int64 `json:"order_version"`
		}{order.Version}, nil
	}
	in, e := assetCommandInput(c)
	if e != nil {
		return nil, e
	}
	if e = assetVersion(order.Version, in.ExpectedVersion); e != nil {
		return nil, e
	}
	lines, e := assetAll(ctx, r.ArrivalLines, "purchase_batch_id", order.ID)
	if e != nil {
		return nil, e
	}
	switch op {
	case "open":
		if order.State != "draft" || len(lines) == 0 {
			return nil, assetErr("STATE_CONFLICT", "需要含明细的草稿到货单")
		}
		if e = assetCompany(ctx, r, order.SupplierID, 2); e != nil {
			return nil, e
		}
		for _, l := range lines {
			if _, _, e = catalogPublished(ctx, r, l.DeviceModelRevisionID, false); e != nil {
				return nil, e
			}
			parts, e := assetAll(ctx, r.ArrivalComponents, "purchase_line_id", l.ID)
			if e != nil {
				return nil, e
			}
			for _, p := range parts {
				if e = componentCompatible(ctx, r, l.DeviceModelRevisionID, p.PartModelRevisionID, p.SlotKey); e != nil {
					return nil, e
				}
			}
		}
		order.State = "open"
		order.OpenedAt = new(time.Now().UTC())
	case "close", "cancel":
		if e = assetText(in.Reason, 1024, true); e != nil {
			return nil, e
		}
		if order.State != "open" && !(op == "cancel" && order.State == "draft") {
			return nil, assetErr("STATE_CONFLICT", "单据状态不允许关闭或取消")
		}
		q := assetQ("purchase_batch_id", order.ID)
		q.Filters = append(q.Filters, domain.AssetFilter{Field: "state", Value: "draft"})
		active, e := r.Receipts.List(ctx, q)
		if e != nil {
			return nil, e
		}
		if active.Total > 0 {
			return nil, assetErr("STATE_CONFLICT", "请先取消未完成的验收草稿")
		}
		if op == "cancel" {
			for _, l := range lines {
				if l.AcceptedQuantity > 0 {
					return nil, assetErr("STATE_CONFLICT", "已有资产入库不能取消到货单")
				}
			}
			order.State = "canceled"
		} else {
			order.State = "closed"
		}
		order.ClosedAt = new(time.Now().UTC())
		order.CloseReason = &in.Reason
	default:
		return nil, assetErr("RESOURCE_NOT_FOUND", "未知到货单操作")
	}
	order.Version++
	return order, r.ArrivalOrders.Save(ctx, order)
}
