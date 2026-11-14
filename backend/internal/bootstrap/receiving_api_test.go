package bootstrap

import (
	"bytes"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func receivingRequest(t *testing.T, app *fiber.App, method, path, token, key string, input any) apiResult {
	t.Helper()
	body, e := json.Marshal(input)
	if e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("X-Request-Id", "receiving-test-request")
	res, e := app.Test(req, fiber.TestConfig{Timeout: 20 * time.Second})
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	var env response.Envelope[jsontext.Value]
	raw, e := io.ReadAll(res.Body)
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(raw, &env); e != nil {
		t.Fatalf("%s %s: %v %s", method, path, e, raw)
	}
	return apiResult{Status: res.StatusCode, Code: env.Code, Message: env.Message, Data: env.Data}
}
func receivingOK[T any](t *testing.T, app *fiber.App, method, path, token string, input any) T {
	t.Helper()
	res := receivingRequest(t, app, method, path, token, uuid.NewString(), input)
	if res.Status != 200 {
		t.Fatalf("%s %s: %d %s %s", method, path, res.Status, res.Message, res.Data)
	}
	return decode[T](t, res.Data)
}

type receivingFixture struct {
	container          *AppContainer
	app                *fiber.App
	token              string
	partRev, deviceRev uuid.UUID
	order              domain.ArrivalOrder
	line               domain.ArrivalLine
	warehouse          domain.Warehouse
}

func newReceivingFixture(t *testing.T, quantity int) receivingFixture {
	t.Helper()
	container, app, _ := setupTestApp(t)
	token := adminToken(t, app)
	company := managedCreate[domain.Company](t, app, token, "/api/v1/vendor-management/companies", map[string]any{"name": "Receiving manufacturer", "type": 3})
	center := createTestLocation(t, app, token, "datacenter", "Receiving center", nil, map[string]any{"address": "test", "contact": map[string]any{"name": "test"}})
	warehouse := managedCreate[domain.Warehouse](t, app, token, "/api/v1/locations/warehouses", map[string]any{"name": "Receiving warehouse", "datacenter_id": center.UID})
	part := receivingOK[domain.CatalogModel](t, app, "POST", "/model-management/component-models", token, map[string]any{"manufacturer_id": company.ID, "part_no": "MEM32", "name": "32GB memory", "kind": "memory"})
	partPath := "/model-management/component-models/" + part.ID.String() + "/revisions"
	pr := receivingOK[domain.CatalogRevision](t, app, "POST", partPath, token, map[string]any{})
	pr = receivingOK[domain.CatalogRevision](t, app, "PUT", partPath+"/"+pr.ID.String(), token, map[string]any{"expected_version": pr.Version, "data": map[string]any{"tracking_mode": "individual", "unit": "piece", "spec": map[string]any{"schema_version": 1, "capacity_bytes": 34359738368, "memory_generation": "DDR5", "speed_mt_s": 4800}}})
	pr = receivingOK[domain.CatalogRevision](t, app, "POST", partPath+"/"+pr.ID.String()+"/publish", token, map[string]any{"expected_version": pr.Version})
	device := receivingOK[domain.CatalogModel](t, app, "POST", "/model-management/device-models", token, map[string]any{"manufacturer_id": company.ID, "model_name": "ServerA", "name": "Server A", "category": "server"})
	devicePath := "/model-management/device-models/" + device.ID.String() + "/revisions"
	dr := receivingOK[domain.CatalogRevision](t, app, "POST", devicePath, token, map[string]any{})
	dr = receivingOK[domain.CatalogRevision](t, app, "PUT", devicePath+"/"+dr.ID.String(), token, map[string]any{"expected_version": dr.Version, "data": map[string]any{"mounting_type": "rack", "height_u": 2, "rated_power_w": 800, "spec": map[string]any{"schema_version": 1}, "slots": []any{}, "ports": []any{}, "standard_components": []any{map[string]any{"part_model_revision_id": pr.ID, "quantity": 16, "required": true}}, "compatibilities": []any{map[string]any{"part_model_revision_id": pr.ID, "status": "confirmed", "evidence_note": "verified manufacturer list"}}}})
	dr = receivingOK[domain.CatalogRevision](t, app, "POST", devicePath+"/"+dr.ID.String()+"/publish", token, map[string]any{"expected_version": dr.Version})
	order := receivingOK[domain.ArrivalOrder](t, app, "POST", "/arrival-orders", token, map[string]any{"name": "Receiving order", "supplier_id": company.ID, "expected_arrival_date": "2026-11-14"})
	lineResult := receivingOK[struct {
		Line         domain.ArrivalLine `json:"line"`
		OrderVersion int64              `json:"order_version"`
	}](t, app, "POST", "/arrival-orders/"+order.ID.String()+"/lines", token, map[string]any{"expected_version": order.Version, "device_model_revision_id": dr.ID, "planned_quantity": quantity, "configuration_source": "model"})
	order = receivingOK[domain.ArrivalOrder](t, app, "POST", "/arrival-orders/"+order.ID.String()+"/open", token, map[string]any{"expected_version": lineResult.OrderVersion})
	if order.ExpectedArrivalDate == nil || *order.ExpectedArrivalDate != "2026-11-14" {
		t.Fatalf("arrival date did not round trip: %v", order.ExpectedArrivalDate)
	}
	return receivingFixture{container: container, app: app, token: token, partRev: pr.ID, deviceRev: dr.ID, order: order, line: lineResult.Line, warehouse: warehouse}
}
func (f receivingFixture) draft(t *testing.T, sn string) (domain.Receipt, domain.ReceiptItem) {
	t.Helper()
	rec := receivingOK[domain.Receipt](t, f.app, "POST", "/receipts", f.token, map[string]any{"purchase_batch_id": f.order.ID})
	return f.addDraftItem(t, rec, sn)
}
func (f receivingFixture) addDraftItem(t *testing.T, rec domain.Receipt, sn string) (domain.Receipt, domain.ReceiptItem) {
	t.Helper()
	created := receivingOK[struct {
		Item           domain.ReceiptItem `json:"item"`
		ReceiptVersion int64              `json:"receipt_version"`
	}](t, f.app, "POST", "/receipts/"+rec.ID.String()+"/items", f.token, map[string]any{"expected_version": rec.Version, "purchase_line_id": f.line.ID, "serial_number": sn, "configuration_source": "order"})
	item := created.Item
	rec.Version = created.ReceiptVersion
	body := bytes.Buffer{}
	w := multipart.NewWriter(&body)
	if e := w.WriteField("expected_version", strconv.FormatInt(rec.Version, 10)); e != nil {
		t.Fatal(e)
	}
	part, e := w.CreateFormFile("file", "evidence.png")
	if e != nil {
		t.Fatal(e)
	}
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.White)
	if e = png.Encode(part, img); e != nil {
		t.Fatal(e)
	}
	if e = w.Close(); e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest("POST", "/api/v1/receipts/"+rec.ID.String()+"/items/"+item.ID.String()+"/photos", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", f.token)
	req.Header.Set("Idempotency-Key", uuid.NewString())
	res, e := f.app.Test(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	raw, e := io.ReadAll(res.Body)
	if e != nil {
		t.Fatal(e)
	}
	var uploaded response.Envelope[struct {
		ReceiptVersion int64 `json:"receipt_version"`
	}]
	if e = json.Unmarshal(raw, &uploaded); e != nil || res.StatusCode != 200 {
		t.Fatalf("upload: %v %s", e, raw)
	}
	rec.Version = uploaded.Data.ReceiptVersion
	updated := receivingOK[struct {
		Item           domain.ReceiptItem `json:"item"`
		ReceiptVersion int64              `json:"receipt_version"`
	}](t, f.app, "PUT", "/receipts/"+rec.ID.String()+"/items/"+item.ID.String(), f.token, map[string]any{"expected_version": rec.Version, "data": map[string]any{"serial_number": sn, "location": map[string]any{"warehouse_id": f.warehouse.ID}, "inspection_result": "pass", "inspected_at": time.Now().Add(-time.Minute).UTC(), "configuration_confirmed": true}})
	rec.Version = updated.ReceiptVersion
	return rec, updated.Item
}
func TestReceivingAtomicAcceptanceAndImmutableBaseline(t *testing.T) {
	f := newReceivingFixture(t, 2)
	rec, item := f.draft(t, "SERVER-001")
	preview := receivingOK[domain.ReceiptPreview](t, f.app, "POST", "/receipts/"+rec.ID.String()+"/preview", f.token, map[string]any{"expected_version": rec.Version})
	if !preview.CanComplete || len(preview.Warnings) != 16 {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	key := uuid.NewString()
	path := "/receipts/" + rec.ID.String() + "/complete"
	body := map[string]any{"expected_version": rec.Version}
	res := receivingRequest(t, f.app, "POST", path, f.token, key, body)
	expectCode(t, res, 200, response.CodeSuccess)
	result := decode[domain.ReceiptResult](t, res.Data)
	if result.AcceptedDeviceCount != 1 || result.CreatedPartCount != 16 {
		t.Fatalf("unexpected result %+v", result)
	}
	replay := receivingRequest(t, f.app, "POST", path, f.token, key, body)
	expectCode(t, replay, 200, response.CodeSuccess)
	if decode[domain.ReceiptResult](t, replay.Data) != result {
		t.Fatal("idempotent result changed")
	}
	expectCode(t, receivingRequest(t, f.app, "POST", path, f.token, key, map[string]any{"expected_version": 99}), 409, response.CodeResourceConflict)
	expectCode(t, receivingRequest(t, f.app, "POST", path, f.token, uuid.NewString(), body), 409, response.CodeResourceConflict)
	var devices []domain.AssetDevice
	if e := f.container.DB.Find(&devices).Error; e != nil || len(devices) != 1 {
		t.Fatalf("devices=%d err=%v", len(devices), e)
	}
	device := devices[0]
	history := receivingOK[response.PageData[domain.AssetAction]](t, f.app, "GET", "/assets/devices/"+device.ID.String()+"/history?page=2&page_size=1", f.token, nil)
	if history.Total != 1 || len(history.Items) != 0 {
		t.Fatalf("device history pagination: %+v", history)
	}
	var parts []domain.AssetPart
	if e := f.container.DB.Find(&parts).Error; e != nil || len(parts) != 16 {
		t.Fatalf("parts=%d err=%v", len(parts), e)
	}
	var original domain.ReceiptBaselineItem
	if e := f.container.DB.First(&original, "part_item_id = ?", parts[0].ID).Error; e != nil {
		t.Fatal(e)
	}
	before, e := json.Marshal(original)
	if e != nil {
		t.Fatal(e)
	}
	receivingOK[domain.AssetPart](t, f.app, "PATCH", "/assets/components/"+parts[0].ID.String()+"/serial-number", f.token, map[string]any{"expected_version": parts[0].Version, "serial_number": "MEM-0001", "reason": "read label"})
	var unchanged domain.ReceiptBaselineItem
	if e = f.container.DB.First(&unchanged, "id = ?", original.ID).Error; e != nil {
		t.Fatal(e)
	}
	after, e := json.Marshal(unchanged)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(before, after) || unchanged.SerialNumberAtReceipt != nil {
		t.Fatal("SN fill changed immutable baseline")
	}
	expectCode(t, receivingRequest(t, f.app, "PATCH", "/assets/components/"+parts[1].ID.String()+"/serial-number", f.token, uuid.NewString(), map[string]any{"expected_version": parts[1].Version, "serial_number": "mem-0001", "reason": "duplicate"}), 409, response.CodeResourceConflict)
	if e = f.container.DB.Model(&domain.ReceiptBaselineItem{}).Where("id = ?", original.ID).Update("original_slot_key", "FAKE").Error; e == nil {
		t.Fatal("database accepted a baseline edit")
	}
	if e = f.container.DB.Model(&domain.CatalogRevision{}).Where("id = ?", f.deviceRev).Update("height_u", 3).Error; e == nil {
		t.Fatal("database accepted published revision edit")
	}
	if e = f.container.DB.Model(&domain.ReceiptItem{}).Where("id = ?", item.ID).Update("serial_number", "ALTERED").Error; e == nil {
		t.Fatal("database accepted completed receipt edit")
	}
	current := receivingOK[struct {
		ComponentCount int64 `json:"component_count"`
	}](t, f.app, "GET", "/assets/devices/"+device.ID.String()+"/current-configuration", f.token, nil)
	if current.ComponentCount != 16 {
		t.Fatal("wrong installed count")
	}
	var line domain.ArrivalLine
	if e = f.container.DB.First(&line, "id = ?", f.line.ID).Error; e != nil || line.AcceptedQuantity != 1 {
		t.Fatalf("line %+v err=%v", line, e)
	}
	var audit domain.AssetAction
	if e = f.container.DB.Where("kind = ?", "receipt_accept").First(&audit).Error; e != nil || audit.RequestID != "receiving-test-request" {
		t.Fatalf("correlation missing: %v %+v", e, audit)
	}
}
func TestReceivingConcurrentRemainingQuantity(t *testing.T) {
	f := newReceivingFixture(t, 1)
	a, _ := f.draft(t, "SERVER-A")
	b, _ := f.draft(t, "SERVER-B")
	var wg sync.WaitGroup
	out := make(chan apiResult, 2)
	for _, rec := range []domain.Receipt{a, b} {
		wg.Go(func() {
			out <- receivingRequest(t, f.app, "POST", "/receipts/"+rec.ID.String()+"/complete", f.token, uuid.NewString(), map[string]any{"expected_version": rec.Version})
		})
	}
	wg.Wait()
	close(out)
	success, conflict := 0, 0
	for r := range out {
		if r.Status == 200 {
			success++
		} else if r.Status == 409 {
			conflict++
		} else {
			t.Fatalf("unexpected %+v", r)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success=%d conflict=%d", success, conflict)
	}
	var count int64
	if e := f.container.DB.Model(&domain.AssetDevice{}).Count(&count).Error; e != nil || count != 1 {
		t.Fatalf("asset count=%d err=%v", count, e)
	}
}

func TestReceivingRollbackAndRoleBoundaries(t *testing.T) {
	f := newReceivingFixture(t, 2)
	rec, item := f.draft(t, "ROLLBACK-SN")
	// An error after creating the device must roll back the whole acceptance.
	if e := f.container.DB.Exec(`CREATE FUNCTION reject_test_part() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER reject_test_part BEFORE INSERT ON part_item FOR EACH ROW EXECUTE FUNCTION reject_test_part();`).Error; e != nil {
		t.Fatal(e)
	}
	key := uuid.NewString()
	path := "/receipts/" + rec.ID.String() + "/complete"
	body := map[string]any{"expected_version": rec.Version}
	expectCode(t, receivingRequest(t, f.app, "POST", path, f.token, key, body), 409, response.CodeResourceConflict)
	for _, table := range []string{"ast_device", "part_item", "res_object", "ast_receipt_baseline"} {
		var n int64
		if e := f.container.DB.Table(table).Count(&n).Error; e != nil || n != 0 {
			t.Fatalf("partial write in %s: count=%d err=%v", table, n, e)
		}
	}
	var stored domain.Receipt
	if e := f.container.DB.First(&stored, "id = ?", rec.ID).Error; e != nil || stored.State != "draft" || stored.Version != rec.Version {
		t.Fatalf("draft changed after failure: %v %+v", e, stored)
	}
	if e := f.container.DB.Exec(`DROP TRIGGER reject_test_part ON part_item; DROP FUNCTION reject_test_part();`).Error; e != nil {
		t.Fatal(e)
	}
	expectCode(t, receivingRequest(t, f.app, "POST", path, f.token, key, body), 200, response.CodeSuccess)
	// Seeded route permissions must include every implemented receiving API.
	for _, route := range domain.ReceivingRoutes() {
		var n int64
		if e := f.container.DB.Model(&domain.Permission{}).Where("code = ?", domain.APIPermissionCode(route.Method, "/api/v1"+route.Path)).Count(&n).Error; e != nil || n != 1 {
			t.Fatalf("permission missing %s %s: %v", route.Method, route.Path, e)
		}
	}
	role := managedCreate[domain.Role](t, f.app, f.token, "/api/v1/roles", map[string]any{"code": "receiving-read", "name": "Receiving read"})
	ids := permissionIDs(t, f.container, domain.APIPermissionCode("GET", "/api/v1/receipts/:id"), domain.APIPermissionCode("GET", "/api/v1/asset-attachments/:id/content"))
	expectCode(t, assignRolePermissions(t, f.app, f.token, role.ID, ids), 200, response.CodeSuccess)
	createLocalUser(t, f.app, f.token, "receiving-reader", map[string]any{"role_ids": []uuid.UUID{role.ID}})
	reader := tokenFor(t, f.app, "receiving-reader", "Str0ng!pass")
	expectCode(t, receivingRequest(t, f.app, "GET", "/receipts/"+rec.ID.String(), reader, "", nil), 200, response.CodeSuccess)
	expectCode(t, receivingRequest(t, f.app, "POST", path, reader, uuid.NewString(), body), 403, response.CodePermissionDenied)
	var photo domain.AssetAttachment
	if e := f.container.DB.Where("receipt_item_id = ?", item.ID).First(&photo).Error; e != nil {
		t.Fatal(e)
	}
	download := func(token string) int {
		req := httptest.NewRequest("GET", "/api/v1/asset-attachments/"+photo.ID.String()+"/content", nil)
		req.Header.Set("Authorization", token)
		res, e := f.app.Test(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		if res.StatusCode == 200 {
			raw, e := io.ReadAll(res.Body)
			if e != nil || !bytes.Equal(raw, photo.Content) {
				t.Fatal("evidence content mismatch")
			}
		}
		return res.StatusCode
	}
	if got := download(reader); got != 200 {
		t.Fatalf("authorized image got %d", got)
	}
	// Giving the content route alone cannot expose a receipt without read access.
	ids = permissionIDs(t, f.container, domain.APIPermissionCode("GET", "/api/v1/asset-attachments/:id/content"))
	expectCode(t, assignRolePermissions(t, f.app, f.token, role.ID, ids), 200, response.CodeSuccess)
	if got := download(reader); got != 403 {
		t.Fatalf("image accessible without parent read: %d", got)
	}
}

func TestReceivingConfigurationHistorySurvivesFutureMovement(t *testing.T) {
	f := newReceivingFixture(t, 2)
	a, _ := f.draft(t, "ORIGINAL-A")
	b, _ := f.draft(t, "ORIGINAL-B")
	for _, rec := range []domain.Receipt{a, b} {
		receivingOK[domain.ReceiptResult](t, f.app, "POST", "/receipts/"+rec.ID.String()+"/complete", f.token, map[string]any{"expected_version": rec.Version})
	}
	var devices []domain.AssetDevice
	if e := f.container.DB.Order("serial_number").Find(&devices).Error; e != nil || len(devices) != 2 {
		t.Fatalf("devices: %v", e)
	}
	var original []domain.ReceiptBaselineItem
	var base domain.ReceiptBaseline
	if e := f.container.DB.First(&base, "device_id = ?", devices[0].ID).Error; e != nil {
		t.Fatal(e)
	}
	if e := f.container.DB.Order("id").Find(&original, "baseline_id = ?", base.ID).Error; e != nil {
		t.Fatal(e)
	}
	before, e := json.Marshal(original)
	if e != nil {
		t.Fatal(e)
	}
	// This is a database fixture for a future movement command, not a public API.
	if e = f.container.DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		remove := domain.AssetAction{ID: uuid.New(), Kind: "future_test_remove", ResourceID: devices[0].ID, ActorUserID: a.CreatedBy, Before: datatypes.NewJSONType(jsontext.Value("null")), After: datatypes.NewJSONType(jsontext.Value("null"))}
		if e := tx.Create(&remove).Error; e != nil {
			return e
		}
		install := domain.AssetAction{ID: uuid.New(), Kind: "future_test_install", ResourceID: devices[0].ID, ActorUserID: a.CreatedBy, Before: datatypes.NewJSONType(jsontext.Value("null")), After: datatypes.NewJSONType(jsontext.Value("null"))}
		if e := tx.Create(&install).Error; e != nil {
			return e
		}
		for i, d := range devices {
			var allocs []domain.PartAllocation
			if e := tx.Order("id").Limit(8).Find(&allocs, "device_id = ? AND ended_recorded_at IS NULL", d.ID).Error; e != nil {
				return e
			}
			for _, allocation := range allocs {
				if e := tx.Model(&domain.PartAllocation{}).Where("id = ?", allocation.ID).Updates(map[string]any{"ended_recorded_at": now, "removed_at": now, "end_action_id": remove.ID}).Error; e != nil {
					return e
				}
				movement := domain.PartMovement{ID: uuid.New(), PartItemID: allocation.PartItemID, ActionID: remove.ID, EventType: "remove", FromDeviceID: &d.ID, ToCustodyLocationID: &d.CurrentCustodyLocationID, RecordedAt: now}
				if e := tx.Create(&movement).Error; e != nil {
					return e
				}
				fields := map[string]any{"kind": "stored", "allocation_id": nil, "custody_location_id": d.CurrentCustodyLocationID, "last_action_id": remove.ID}
				if i == 1 {
					next := domain.PartAllocation{ID: uuid.New(), PartItemID: allocation.PartItemID, DeviceID: devices[0].ID, InstalledAt: &now, RecordedAt: now, StartActionID: install.ID}
					if e := tx.Create(&next).Error; e != nil {
						return e
					}
					fields = map[string]any{"kind": "installed", "allocation_id": next.ID, "custody_location_id": nil, "last_action_id": install.ID}
					ev := domain.PartMovement{ID: uuid.New(), PartItemID: allocation.PartItemID, ActionID: install.ID, EventType: "install", FromCustodyLocationID: &d.CurrentCustodyLocationID, ToDeviceID: &devices[0].ID, RecordedAt: now}
					if e := tx.Create(&ev).Error; e != nil {
						return e
					}
				}
				if e := tx.Model(&domain.PartPlacement{}).Where("part_item_id = ?", allocation.PartItemID).Updates(fields).Error; e != nil {
					return e
				}
			}
			if e := tx.Model(&domain.AssetDevice{}).Where("id = ?", d.ID).Update("configuration_version", 2).Error; e != nil {
				return e
			}
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	var afterRows []domain.ReceiptBaselineItem
	if e = f.container.DB.Order("id").Find(&afterRows, "baseline_id = ?", base.ID).Error; e != nil {
		t.Fatal(e)
	}
	after, e := json.Marshal(afterRows)
	if e != nil || !bytes.Equal(before, after) {
		t.Fatal("movement changed original membership")
	}
	diff := receivingOK[struct {
		Items []struct {
			Change string `json:"change"`
		} `json:"items"`
		Total int64 `json:"total"`
	}](t, f.app, "GET", "/assets/devices/"+devices[0].ID.String()+"/configuration-diff?page_size=100", f.token, nil)
	counts := map[string]int{}
	for _, row := range diff.Items {
		counts[row.Change]++
	}
	if counts["removed"] != 8 || counts["added"] != 8 || counts["unchanged"] != 8 {
		t.Fatalf("wrong same-model replacement diff: %+v", counts)
	}
	expectCode(t, receivingRequest(t, f.app, "GET", "/assets/devices/"+devices[0].ID.String()+"/current-configuration?expected_configuration_version=1", f.token, "", nil), 409, response.CodeResourceConflict)
	var place domain.PartPlacement
	if e = f.container.DB.First(&place, "kind = ?", "installed").Error; e != nil {
		t.Fatal(e)
	}
	if e = f.container.DB.Model(&place).Updates(map[string]any{"kind": "stored", "allocation_id": nil, "custody_location_id": devices[0].CurrentCustodyLocationID}).Error; e == nil {
		t.Fatal("database allowed installed component to also become stored")
	}
}

func TestReceivingBatchActualQuantityAndRejection(t *testing.T) {
	f := newReceivingFixture(t, 10)
	rec := receivingOK[domain.Receipt](t, f.app, "POST", "/receipts", f.token, map[string]any{"purchase_batch_id": f.order.ID})
	for i := range 6 {
		rec, _ = f.addDraftItem(t, rec, "BATCH-"+strconv.Itoa(i))
	}
	rec, rejected := f.addDraftItem(t, rec, "REJECTED-ONE")
	updated := receivingOK[struct {
		ReceiptVersion int64 `json:"receipt_version"`
	}](t, f.app, "PUT", "/receipts/"+rec.ID.String()+"/items/"+rejected.ID.String(), f.token, map[string]any{"expected_version": rec.Version, "data": map[string]any{"serial_number": "REJECTED-ONE", "inspection_result": "reject", "inspected_at": time.Now().Add(-time.Minute), "reject_reason": "外观损坏", "configuration_confirmed": false}})
	rec.Version = updated.ReceiptVersion
	result := receivingOK[domain.ReceiptResult](t, f.app, "POST", "/receipts/"+rec.ID.String()+"/complete", f.token, map[string]any{"expected_version": rec.Version})
	if result.AcceptedDeviceCount != 6 || result.RejectedDeviceCount != 1 || result.CreatedPartCount != 96 {
		t.Fatalf("unexpected batch result %+v", result)
	}
	order := receivingOK[struct {
		AcceptedQuantity  int `json:"accepted_quantity"`
		RemainingQuantity int `json:"remaining_quantity"`
	}](t, f.app, "GET", "/arrival-orders/"+f.order.ID.String(), f.token, nil)
	if order.AcceptedQuantity != 6 || order.RemainingQuantity != 4 {
		t.Fatalf("unexpected remaining %+v", order)
	}
	var n int64
	if e := f.container.DB.Model(&domain.AssetDevice{}).Where("source_receipt_item_id = ?", rejected.ID).Count(&n).Error; e != nil || n != 0 {
		t.Fatal("rejected device created an asset")
	}
	var part domain.AssetPart
	if e := f.container.DB.First(&part).Error; e != nil {
		t.Fatal(e)
	}
	// Child routes must not accept an item belonging to a different receipt.
	other := receivingOK[domain.Receipt](t, f.app, "POST", "/receipts", f.token, map[string]any{"purchase_batch_id": f.order.ID})
	expectCode(t, receivingRequest(t, f.app, "GET", "/receipts/"+other.ID.String()+"/items/"+rejected.ID.String(), f.token, "", nil), 404, response.CodeManagedNotFound)
	page := receivingOK[response.PageData[domain.AssetPart]](t, f.app, "GET", "/assets/components?serial_status=missing&page_size=100", f.token, nil)
	if page.Total != 96 {
		t.Fatalf("component query total=%d", page.Total)
	}
}

func TestReceivingUsesActualComponentQuantity(t *testing.T) {
	f := newReceivingFixture(t, 1)
	rec, item := f.draft(t, "ACTUAL-EIGHT")
	itemPath := "/receipts/" + rec.ID.String() + "/items/" + item.ID.String()
	parts := receivingOK[response.PageData[domain.ReceiptComponent]](t, f.app, "GET", itemPath+"/components", f.token, nil)
	if len(parts.Items) != 16 {
		t.Fatalf("expected 16 planned components, got %d", len(parts.Items))
	}
	for _, part := range parts.Items[:8] {
		deleted := receivingOK[struct {
			ReceiptVersion int64 `json:"receipt_version"`
		}](t, f.app, "DELETE", itemPath+"/components/"+part.ID.String()+"?expected_version="+strconv.FormatInt(rec.Version, 10), f.token, nil)
		rec.Version = deleted.ReceiptVersion
	}
	preview := receivingOK[domain.ReceiptPreview](t, f.app, "POST", "/receipts/"+rec.ID.String()+"/preview", f.token, map[string]any{"expected_version": rec.Version})
	if preview.CanComplete {
		t.Fatal("unexplained configuration difference was accepted")
	}
	updated := receivingOK[struct {
		ReceiptVersion int64 `json:"receipt_version"`
	}](t, f.app, "PUT", itemPath, f.token, map[string]any{"expected_version": rec.Version, "data": map[string]any{"serial_number": "ACTUAL-EIGHT", "location": map[string]any{"warehouse_id": f.warehouse.ID}, "inspection_result": "pass", "inspected_at": time.Now().Add(-time.Minute).UTC(), "configuration_confirmed": true, "difference_reason": "实际交付 8 根内存"}})
	result := receivingOK[domain.ReceiptResult](t, f.app, "POST", "/receipts/"+rec.ID.String()+"/complete", f.token, map[string]any{"expected_version": updated.ReceiptVersion})
	if result.CreatedPartCount != 8 {
		t.Fatalf("created %d parts instead of actual 8", result.CreatedPartCount)
	}
	var baselineCount int64
	if err := f.container.DB.Model(&domain.ReceiptBaselineItem{}).Count(&baselineCount).Error; err != nil || baselineCount != 8 {
		t.Fatalf("baseline count=%d error=%v", baselineCount, err)
	}
}
