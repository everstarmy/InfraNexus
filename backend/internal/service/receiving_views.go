package service

import (
	"context"

	"infranexus/internal/domain"
)

type catalogView struct {
	domain.CatalogModel
	LatestPublishedRevision *domain.CatalogRevision `json:"latest_published_revision"`
}

func catalogDetails(ctx context.Context, repo domain.AssetRepository[domain.CatalogRevision], m domain.CatalogModel) (catalogView, error) {
	out := catalogView{CatalogModel: m}
	q := assetQ("model_id", m.ID)
	q.Filters = append(q.Filters, domain.AssetFilter{Field: "state", Value: "published"})
	rows, e := repo.List(ctx, q)
	if e != nil {
		return out, e
	}
	for _, v := range rows.Items {
		if out.LatestPublishedRevision == nil || v.RevisionNo > out.LatestPublishedRevision.RevisionNo {
			out.LatestPublishedRevision = new(v)
		}
	}
	return out, nil
}

type arrivalOrderView struct {
	domain.ArrivalOrder
	PlannedQuantity   int      `json:"planned_quantity"`
	AcceptedQuantity  int      `json:"accepted_quantity"`
	RemainingQuantity int      `json:"remaining_quantity"`
	AllowedActions    []string `json:"allowed_actions"`
}

func arrivalDetails(ctx context.Context, r domain.ReceivingRepositories, o domain.ArrivalOrder) (arrivalOrderView, error) {
	out := arrivalOrderView{ArrivalOrder: o, AllowedActions: []string{}}
	lines, e := assetAll(ctx, r.ArrivalLines, "purchase_batch_id", o.ID)
	if e != nil {
		return out, e
	}
	for _, l := range lines {
		out.PlannedQuantity += l.PlannedQuantity
		out.AcceptedQuantity += l.AcceptedQuantity
	}
	out.RemainingQuantity = out.PlannedQuantity - out.AcceptedQuantity
	switch o.State {
	case "draft":
		out.AllowedActions = []string{"update", "open", "cancel"}
	case "open":
		out.AllowedActions = []string{"receive", "close"}
		if out.AcceptedQuantity == 0 {
			out.AllowedActions = append(out.AllowedActions, "cancel")
		}
	}
	return out, nil
}

type receiptView struct {
	domain.Receipt
	DeviceCount    int      `json:"device_count"`
	ComponentCount int      `json:"component_count"`
	PassedCount    int      `json:"passed_count"`
	RejectedCount  int      `json:"rejected_count"`
	AllowedActions []string `json:"allowed_actions"`
}

func receiptDetails(ctx context.Context, r domain.ReceivingRepositories, rec domain.Receipt) (receiptView, error) {
	out := receiptView{Receipt: rec, AllowedActions: []string{}}
	items, e := receiptItems(ctx, r, rec.ID)
	if e != nil {
		return out, e
	}
	out.DeviceCount = len(items)
	for _, i := range items {
		if i.InspectionResult == "pass" {
			out.PassedCount++
		}
		if i.InspectionResult == "reject" {
			out.RejectedCount++
		}
		p, e := r.ReceiptComponents.List(ctx, assetQ("receipt_item_id", i.ID))
		if e != nil {
			return out, e
		}
		out.ComponentCount += int(p.Total)
	}
	if rec.State == "draft" {
		out.AllowedActions = []string{"update", "evidence", "preview", "complete", "cancel"}
	}
	return out, nil
}
