package bootstrap

import (
	"testing"

	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func TestReceivingDeviceRevisionOptions(t *testing.T) {
	f := newReceivingFixture(t, 2)
	var original domain.CatalogRevision
	if err := f.container.DB.First(&original, "id = ?", f.deviceRev).Error; err != nil {
		t.Fatal(err)
	}
	root := "/model-management/device-models/" + original.ModelID.String() + "/revisions"
	originalPath := root + "/" + original.ID.String()
	draft := receivingOK[domain.CatalogRevision](t, f.app, "POST", root, f.token, map[string]any{"from_revision_id": original.ID})
	draftPath := root + "/" + draft.ID.String()
	draft = receivingOK[domain.CatalogRevision](t, f.app, "PUT", draftPath, f.token, map[string]any{
		"expected_version": draft.Version,
		"data": map[string]any{
			"name": "512 GB 配置", "description": "16 槽内存配置", "mounting_type": "rack", "height_u": 2,
			"spec":                map[string]any{"schema_version": 1},
			"slots":               []any{map[string]any{"stable_key": "DIMM01", "name": "DIMM 1", "kind": "memory", "interface": "DDR5", "position": map[string]any{"schema_version": 1}}},
			"standard_components": []any{map[string]any{"part_model_revision_id": f.partRev, "slot_key": "DIMM01", "quantity": 1}},
			"compatibilities":     []any{map[string]any{"part_model_revision_id": f.partRev, "slot_key": "DIMM01", "status": "confirmed", "evidence_note": "verified"}},
		},
	})
	draft = receivingOK[domain.CatalogRevision](t, f.app, "POST", draftPath+"/publish", f.token, map[string]any{"expected_version": draft.Version})

	type revisionRow struct {
		domain.CatalogRevision
		StandardComponents []domain.ModelComponent `json:"standard_components"`
	}
	options := func() response.PageData[revisionRow] {
		return receivingOK[response.PageData[revisionRow]](t, f.app, "GET", root+"?selectable=true", f.token, nil)
	}
	if page := options(); page.Total != 2 || page.Items[0].Name != "512 GB 配置" || page.Items[0].Description != "16 槽内存配置" || len(page.Items[0].StandardComponents) != 1 {
		t.Fatalf("unexpected selectable versions: %+v", page)
	}
	type candidate struct {
		PartModelRevisionID uuid.UUID `json:"part_model_revision_id"`
		SlotKeys            []string  `json:"slot_keys"`
		AllowsUnassigned    bool      `json:"allows_unassigned"`
	}
	candidates := receivingOK[response.PageData[candidate]](t, f.app, "GET", draftPath+"/compatible-components?kind=memory&slot_key=DIMM01&search=mem32", f.token, nil)
	if candidates.Total != 1 || len(candidates.Items) != 1 || candidates.Items[0].PartModelRevisionID != f.partRev || candidates.Items[0].AllowsUnassigned || len(candidates.Items[0].SlotKeys) != 1 {
		t.Fatalf("unexpected compatibility candidates: %+v", candidates)
	}
	disabled := receivingOK[domain.CatalogRevision](t, f.app, "PATCH", originalPath+"/status", f.token, map[string]any{"expected_version": original.Version, "status": 2})
	if page := options(); disabled.Status != 2 || page.Total != 1 || page.Items[0].ID != draft.ID {
		t.Fatalf("disabled revision still selectable: %+v", page)
	}
	freeOrder := receivingOK[domain.ArrivalOrder](t, f.app, "POST", "/arrival-orders", f.token, map[string]any{"name": "New order", "supplier_id": f.order.SupplierID})
	res := receivingRequest(t, f.app, "POST", "/arrival-orders/"+freeOrder.ID.String()+"/lines", f.token, uuid.NewString(), map[string]any{
		"expected_version": freeOrder.Version, "device_model_revision_id": original.ID, "planned_quantity": 1, "configuration_source": "model",
	})
	expectCode(t, res, 409, response.CodeResourceConflict)
	if err := f.container.DB.Model(&domain.CatalogRevision{}).Where("id = ?", original.ID).Update("name", "不能修改").Error; err == nil {
		t.Fatal("database allowed changing the published configuration name")
	}
	rec, _ := f.draft(t, "RETIRED-VERSION")
	result := receivingOK[domain.ReceiptResult](t, f.app, "POST", "/receipts/"+rec.ID.String()+"/complete", f.token, map[string]any{"expected_version": rec.Version})
	if result.AcceptedDeviceCount != 1 {
		t.Fatalf("existing order could not complete: %+v", result)
	}
	receivingOK[domain.CatalogRevision](t, f.app, "PATCH", originalPath+"/status", f.token, map[string]any{"expected_version": disabled.Version, "status": 1})
	if page := options(); page.Total != 2 {
		t.Fatalf("re-enabled revision missing: %+v", page)
	}
}
