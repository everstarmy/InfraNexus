package service

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"infranexus/internal/domain"
)

type deviceRevisionOption struct {
	domain.CatalogRevision
	StandardComponents []domain.ModelComponent `json:"standard_components"`
}

type compatibleComponentOption struct {
	PartModelID         uuid.UUID        `json:"part_model_id"`
	PartModelRevisionID uuid.UUID        `json:"part_model_revision_id"`
	ManufacturerID      uuid.UUID        `json:"manufacturer_id"`
	Name                string           `json:"name"`
	PartNo              string           `json:"part_no"`
	Kind                string           `json:"kind"`
	RevisionNo          int              `json:"revision_no"`
	Spec                domain.AssetSpec `json:"spec"`
	SlotKeys            []string         `json:"slot_keys"`
	AllowsUnassigned    bool             `json:"allows_unassigned"`
}

type deviceRevisionStatusInput struct {
	ExpectedVersion int64 `json:"expected_version"`
	Status          int   `json:"status"`
}

func requireSelectableDeviceRevision(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID) error {
	_, revision, err := catalogPublished(ctx, r, id, false)
	if err != nil {
		return err
	}
	if revision.Status != domain.StatusEnabled {
		return assetErr("REFERENCE_DISABLED", "设备版本已停用")
	}
	return nil
}

func listDeviceRevisions(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall, model domain.CatalogModel, q domain.AssetQuery) (any, error) {
	out := domain.AssetRows[deviceRevisionOption]{Items: []deviceRevisionOption{}, Page: q.Page, PageSize: q.PageSize}
	if raw := c.Query["status"]; raw != "" {
		status, err := strconv.Atoi(raw)
		if err != nil || (status != domain.StatusEnabled && status != domain.StatusDisabled) {
			return nil, assetErr("VALIDATION_FAILED", "版本状态无效")
		}
		q.Filters = append(q.Filters, domain.AssetFilter{Field: "status", Value: status})
	}
	switch c.Query["selectable"] {
	case "true":
		if model.Status != domain.StatusEnabled {
			return out, nil
		}
		if err := assetCompany(ctx, r, model.ManufacturerID, 1); err != nil {
			if receivingOptionUnavailable(err) {
				return out, nil
			}
			return nil, err
		}
		q.Filters = append(q.Filters, domain.AssetFilter{Field: "status", Value: domain.StatusEnabled}, domain.AssetFilter{Field: "state", Value: "published"})
	case "", "false":
	default:
		return nil, assetErr("VALIDATION_FAILED", "selectable 必须为 true 或 false")
	}
	rows, err := r.CatalogRevisions.List(ctx, q)
	if err != nil {
		return nil, err
	}
	out.Total = rows.Total
	for _, revision := range rows.Items {
		parts, err := assetAll(ctx, r.ModelComponents, "revision_id", revision.ID)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, deviceRevisionOption{CatalogRevision: revision, StandardComponents: parts})
	}
	return out, nil
}

func setDeviceRevisionStatus(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall, revision *domain.CatalogRevision) (any, error) {
	in, err := assetDecode[deviceRevisionStatusInput](c.Body)
	if err != nil {
		return nil, err
	}
	if err = assetVersion(revision.Version, in.ExpectedVersion); err != nil {
		return nil, err
	}
	if revision.State != "published" {
		return nil, assetErr("STATE_CONFLICT", "仅已发布版本可以启停")
	}
	if in.Status != domain.StatusEnabled && in.Status != domain.StatusDisabled {
		return nil, assetErr("VALIDATION_FAILED", "版本状态无效")
	}
	if revision.Status != in.Status {
		revision.Status = in.Status
		revision.Version++
		if err = r.CatalogRevisions.Save(ctx, revision); err != nil {
			return nil, err
		}
	}
	return revisionDetails(ctx, r, *revision, false)
}

func receivingOptionUnavailable(err error) bool {
	var e *domain.ReceivingError
	return errors.As(err, &e) && (e.Reason == "REFERENCE_DISABLED" || e.Reason == "MODEL_NOT_PUBLISHED")
}

func listCompatibleComponents(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall, revision domain.CatalogRevision) (any, error) {
	q, err := assetPage(c)
	if err != nil {
		return nil, err
	}
	if revision.State != "published" {
		return nil, assetErr("MODEL_NOT_PUBLISHED", "设备版本尚未发布")
	}
	slotKey := c.Query["slot_key"]
	kind := c.Query["kind"]
	search := strings.ToLower(strings.TrimSpace(q.Search))
	compatibilities, err := assetAll(ctx, r.ModelCompatibilitys, "revision_id", revision.ID)
	if err != nil {
		return nil, err
	}
	slots, err := assetAll(ctx, r.ModelSlots, "revision_id", revision.ID)
	if err != nil {
		return nil, err
	}
	if slotKey != "" {
		found := false
		for _, slot := range slots {
			if slot.StableKey == slotKey {
				slots = []domain.ModelSlot{slot}
				found = true
				break
			}
		}
		if !found {
			return nil, assetErr("VALIDATION_FAILED", "槽位不属于该设备版本")
		}
	}
	byPart := make(map[uuid.UUID][]domain.ModelCompatibility)
	partIDs := make([]uuid.UUID, 0)
	for _, relation := range compatibilities {
		id := relation.PartModelRevisionID
		if _, exists := byPart[id]; !exists {
			partIDs = append(partIDs, id)
		}
		byPart[id] = append(byPart[id], relation)
	}
	out := domain.AssetRows[compatibleComponentOption]{Items: []compatibleComponentOption{}, Page: q.Page, PageSize: q.PageSize}
	offset := int64((q.Page - 1) * q.PageSize)
	for _, id := range partIDs {
		model, part, err := catalogPublished(ctx, r, id, true)
		if receivingOptionUnavailable(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if (kind != "" && model.Kind != kind) || !strings.Contains(strings.ToLower(model.Name+" "+model.PartNo), search) {
			continue
		}
		relations := byPart[id]
		option := compatibleComponentOption{
			PartModelID: model.ID, PartModelRevisionID: part.ID, ManufacturerID: model.ManufacturerID,
			Name: model.Name, PartNo: model.PartNo, Kind: model.Kind, RevisionNo: part.RevisionNo,
			Spec: part.Spec.Data(), SlotKeys: []string{},
			AllowsUnassigned: slotKey == "" && validateCompatibleComponent(*model, *part, relations, nil, nil) == nil,
		}
		for _, slot := range slots {
			if validateCompatibleComponent(*model, *part, relations, []domain.ModelSlot{slot}, &slot.StableKey) == nil {
				option.SlotKeys = append(option.SlotKeys, slot.StableKey)
			}
		}
		if !option.AllowsUnassigned && len(option.SlotKeys) == 0 {
			continue
		}
		out.Total++
		if out.Total > offset && len(out.Items) < q.PageSize {
			out.Items = append(out.Items, option)
		}
	}
	return out, nil
}
