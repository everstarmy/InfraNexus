package bootstrap

import (
	"bytes"
	"encoding/json"
	jsonv2 "encoding/json/v2"
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func managedCreate[T any](t *testing.T, app *fiber.App, bearer, path string, fields map[string]any) T {
	t.Helper()
	res := call(t, app, "POST", path, bearer, fields)
	expectCode(t, res, 200, response.CodeSuccess)
	return decode[T](t, res.Data)
}

func TestManagementLocationsAndRolePermissions(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	const locations = "/api/v1/locations"
	center := managedCreate[domain.Datacenter](t, app, admin, locations+"/datacenters", map[string]any{"code": "dc-1", "name": "主中心", "kind": "primary"})
	building := managedCreate[domain.Building](t, app, admin, locations+"/buildings", map[string]any{"code": "b1", "name": "一号楼", "datacenter_id": center.ID})
	floor := managedCreate[domain.Floor](t, app, admin, locations+"/floors", map[string]any{"code": "f1", "name": "一层", "building_id": building.ID, "level": 1})
	room := managedCreate[domain.Room](t, app, admin, locations+"/rooms", map[string]any{"code": "r1", "name": "一号机房", "floor_id": floor.ID})
	if room.DatacenterID != center.ID {
		t.Fatal("room datacenter was not derived from its parent")
	}
	row := managedCreate[domain.RackRow](t, app, admin, locations+"/rack-rows", map[string]any{"code": "a", "name": "A 列", "room_id": room.ID})
	rackData := map[string]any{"code": "rk-01", "name": "一号机柜", "rack_row_id": row.ID, "units": 42}
	rack := managedCreate[domain.Rack](t, app, admin, locations+"/racks", rackData)
	rackURL := locations + "/racks/" + rack.ID.String()
	units := call(t, app, "GET", rackURL+"/units", admin, nil)
	expectCode(t, units, 200, response.CodeSuccess)
	view := decode[domain.RackUnitView](t, units.Data)
	if len(view.Units) != 42 || view.Units[0].Unit != 42 || view.Units[0].State != "free" {
		t.Fatalf("unexpected rack view: %+v", view)
	}
	occupied := domain.RackUnitAllocation{RackID: rack.ID, Unit: 42, SubjectID: uuid.New(), State: "reserved"}
	if err := container.DB.Create(&occupied).Error; err != nil {
		t.Fatal(err)
	}
	rackData["units"] = 40
	expectCode(t, call(t, app, "PUT", rackURL, admin, map[string]any{"expected_version": 1, "data": rackData}), 409, response.CodeResourceConflict)
	rackData["units"] = 48
	expectCode(t, call(t, app, "PUT", rackURL, admin, map[string]any{"expected_version": 1, "data": rackData}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "PUT", rackURL, admin, map[string]any{"expected_version": 1, "data": rackData}), 409, response.CodeResourceConflict)
	centerURL := locations + "/datacenters/" + center.ID.String()
	expectCode(t, call(t, app, "DELETE", centerURL+"?expected_version=1", admin, nil), 409, response.CodeResourceConflict)
	expectCode(t, call(t, app, "PATCH", centerURL+"/status", admin, map[string]any{"expected_version": 1, "status": 2}), 409, response.CodeResourceConflict)
	history := call(t, app, "GET", rackURL+"/history", admin, nil)
	expectCode(t, history, 200, response.CodeSuccess)
	audit := decode[response.PageData[domain.ManagedAudit]](t, history.Data)
	if audit.Total != 2 || audit.Items[0].After.Data().Version != 2 || audit.Items[0].ActorID == uuid.Nil || audit.Items[0].RequestID == "" {
		t.Fatalf("unexpected rack audit: %+v", audit)
	}

	// Every registered route must have a built-in API permission on first boot.
	routes, err := discoverAPIRoutes(app)
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range routes {
		if !strings.HasPrefix(route.Path, locations+"/") && !strings.HasPrefix(route.Path, "/api/v1/ipam/") && !strings.HasPrefix(route.Path, "/api/v1/vendor-management/") {
			continue
		}
		var count int64
		if err := container.DB.Model(&domain.Permission{}).Where("code = ? AND built_in", domain.APIPermissionCode(route.Method, route.Path)).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("missing permission for %s %s: %v", route.Method, route.Path, err)
		}
	}
	role := managedCreate[domain.Role](t, app, admin, "/api/v1/roles", map[string]any{"code": "dcim-reader", "name": "数据中心只读"})
	read := permissionIDs(t, container, domain.APIPermissionCode("GET", locations+"/datacenters"), domain.APIPermissionCode("GET", "/api/v1/ipam/subnets"), domain.APIPermissionCode("GET", "/api/v1/vendor-management/manufacturers"))
	expectCode(t, assignRolePermissions(t, app, admin, role.ID, read), 200, response.CodeSuccess)
	createLocalUser(t, app, admin, "dcim-reader", map[string]any{"role_ids": []uuid.UUID{role.ID}})
	reader := tokenFor(t, app, "dcim-reader", "Str0ng!pass")
	for _, path := range []string{locations + "/datacenters", "/api/v1/ipam/subnets", "/api/v1/vendor-management/manufacturers"} {
		expectCode(t, call(t, app, "GET", path, reader, nil), 200, response.CodeSuccess)
		expectCode(t, call(t, app, "POST", path, reader, map[string]any{}), 403, response.CodePermissionDenied)
	}
	expectCode(t, call(t, app, "GET", rackURL+"/history", reader, nil), 403, response.CodePermissionDenied)
}

func TestManagementIPAMIsolationReservationAndConflict(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	const ipam = "/api/v1/ipam"
	center := managedCreate[domain.Datacenter](t, app, admin, "/api/v1/locations/datacenters", map[string]any{"code": "dc", "name": "机房", "kind": "primary"})
	zone := managedCreate[domain.SecurityZone](t, app, admin, ipam+"/security-zones", map[string]any{"code": "prod", "name": "生产", "datacenter_id": center.ID})
	scope := managedCreate[domain.NetworkScope](t, app, admin, ipam+"/network-scopes", map[string]any{"code": "vrf-a", "name": "VRF A"})
	scopeB := managedCreate[domain.NetworkScope](t, app, admin, ipam+"/network-scopes", map[string]any{"code": "vrf-b", "name": "VRF B"})
	fields := func(code, cidr string, id uuid.UUID) map[string]any {
		return map[string]any{
			"code": code, "name": code, "network_scope_id": id, "security_zone_id": zone.ID, "cidr": cidr, "usage_type": "bmc", "is_allocatable": true,
		}
	}
	first := fields("prod-a", "10.0.0.5/29", scope.ID)
	first["gateway"] = "10.0.0.1"
	subnet := managedCreate[domain.Subnet](t, app, admin, ipam+"/subnets", first)
	if subnet.CIDR != "10.0.0.0/29" {
		t.Fatalf("CIDR was not normalized: %s", subnet.CIDR)
	}
	expectCode(t, call(t, app, "POST", ipam+"/subnets", admin, fields("overlap", "10.0.0.4/30", scope.ID)), 409, response.CodeResourceConflict)
	managedCreate[domain.Subnet](t, app, admin, ipam+"/subnets", fields("isolated", "10.0.0.0/29", scopeB.ID))
	var wg sync.WaitGroup
	out := make(chan apiResult, 2)
	for _, code := range []string{"race-a", "race-b"} {
		wg.Go(func() { out <- call(t, app, "POST", ipam+"/subnets", admin, fields(code, "10.1.0.0/24", scope.ID)) })
	}
	wg.Wait()
	close(out)
	succeeded, conflicted := 0, 0
	for result := range out {
		switch result.Status {
		case 200:
			succeeded++
		case 409:
			conflicted++
		default:
			t.Fatalf("unexpected overlap response: %+v", result)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("wanted one overlap winner, got %d success and %d conflicts", succeeded, conflicted)
	}
	poolURL := ipam + "/subnets/" + subnet.ID.String() + "/addresses"
	list := call(t, app, "GET", poolURL, admin, nil)
	expectCode(t, list, 200, response.CodeSuccess)
	pool := decode[response.PageData[domain.IPAddressView]](t, list.Data)
	if pool.Total != 8 || pool.Items[0].ReservationKind != "network" || pool.Items[1].ReservationKind != "gateway" || !pool.Items[2].Available || pool.Items[7].ReservationKind != "broadcast" {
		t.Fatalf("wrong pool reservations: %+v", pool)
	}
	reserve := map[string]any{"expected_version": 0, "reserved": true, "reason": "故障保留"}
	expectCode(t, call(t, app, "PATCH", poolURL+"/10.0.0.1/reservation", admin, reserve), 409, response.CodeResourceConflict)
	ip := poolURL + "/10.0.0.2"
	reserved := call(t, app, "PATCH", ip+"/reservation", admin, reserve)
	expectCode(t, reserved, 200, response.CodeSuccess)
	if view := decode[domain.IPAddressView](t, reserved.Data); view.Version != 1 || view.AllocationState != "free" || view.ReservationKind != "manual" || view.Available {
		t.Fatalf("wrong manual reservation: %+v", view)
	}
	expectCode(t, call(t, app, "PATCH", ip+"/reservation", admin, reserve), 409, response.CodeResourceConflict)
	conflict := managedCreate[domain.IPConflict](t, app, admin, ip+"/conflicts", map[string]any{"observed_identity": "unknown host", "evidence_ref": "inspection-123", "observed_at": time.Now().Add(-time.Minute)})
	item := call(t, app, "GET", ip, admin, nil)
	expectCode(t, item, 200, response.CodeSuccess)
	if view := decode[domain.IPAddressView](t, item.Data); !view.Conflicted || view.ReservationKind != "manual" {
		t.Fatalf("conflict overwrote reservation: %+v", view)
	}
	expectCode(t, call(t, app, "PATCH", ip+"/conflicts/"+conflict.ID.String()+"/resolve", admin, map[string]string{"reason": "现场清理完毕"}), 200, response.CodeSuccess)
	item = call(t, app, "GET", ip, admin, nil)
	if view := decode[domain.IPAddressView](t, item.Data); view.Conflicted || view.ReservationKind != "manual" {
		t.Fatalf("resolution overwrote reservation: %+v", view)
	}
	history := call(t, app, "GET", ip+"/history", admin, nil)
	expectCode(t, history, 200, response.CodeSuccess)
	if got := decode[response.PageData[domain.ManagedAudit]](t, history.Data).Total; got != 3 {
		t.Fatalf("wanted 3 IP history events, got %d", got)
	}
}

func managedRequest(t *testing.T, app *fiber.App, path, bearer, key string, input any) apiResult {
	t.Helper()
	raw, err := jsonv2.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", path, bytes.NewReader(raw))
	req.Header.Set("Authorization", bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var env response.Envelope[json.RawMessage]
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := jsonv2.Unmarshal(body, &env); err != nil {
		t.Fatal(err)
	}
	return apiResult{Status: resp.StatusCode, Code: env.Code, Message: env.Message, Data: env.Data}
}

func TestManagementOrganizationAndAtomicImport(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	const org = "/api/v1/vendor-management"
	data := map[string]any{"code": "mfr-a", "name": "制造商 A", "protocols": []string{"snmpv3"}, "enterprise_oid": 674, "serial_number_pattern": "^[A-Z0-9]+$"}
	first := managedRequest(t, app, org+"/manufacturers", admin, "mfr-a", data)
	expectCode(t, first, 200, response.CodeSuccess)
	mfr := decode[domain.Manufacturer](t, first.Data)
	replay := managedRequest(t, app, org+"/manufacturers", admin, "mfr-a", data)
	expectCode(t, replay, 200, response.CodeSuccess)
	if decode[domain.Manufacturer](t, replay.Data).ID != mfr.ID {
		t.Fatal("create replay generated another identity")
	}
	data["name"] = "Different"
	expectCode(t, managedRequest(t, app, org+"/manufacturers", admin, "mfr-a", data), 409, response.CodeResourceConflict)
	batch := map[string]any{"items": []map[string]string{
		{"code": "new-ok", "name": "合法"}, {"code": "mfr-a", "name": "重复"}, {"code": "bad", "name": "正则错误", "serial_number_pattern": "["},
	}}
	for _, endpoint := range []string{"/import/preview", "/import"} {
		result := managedRequest(t, app, org+"/manufacturers"+endpoint, admin, "failed-import", batch)
		expectCode(t, result, 200, response.CodeSuccess)
		report := decode[domain.ManagedImportResult[domain.Manufacturer]](t, result.Data)
		if len(report.Errors) != 2 || report.Errors[0].Row != 2 || report.Errors[1].Row != 3 || len(report.Items) != 0 {
			t.Fatalf("wrong import report: %+v", report)
		}
	}
	list := call(t, app, "GET", org+"/manufacturers?search=new-ok", admin, nil)
	expectCode(t, list, 200, response.CodeSuccess)
	if decode[response.PageData[domain.Manufacturer]](t, list.Data).Total != 0 {
		t.Fatal("import left a partial record")
	}
	vendor := managedCreate[domain.Vendor](t, app, admin, org+"/vendors", map[string]any{"code": "vendor-a", "name": "供应商 A", "credit_code": "9131011571786564XW", "service_types": []string{"oem_service"}, "cooperation_status": "active"})
	contact := map[string]any{"code": "support", "name": "技术支持", "vendor_id": vendor.ID, "roles": []string{"onsite_engineer"}, "id_document_type": "national_id", "masked_id": "310000199001011234"}
	expectCode(t, call(t, app, "POST", org+"/contacts", admin, contact), 400, response.CodeParamInvalid)
	contact["masked_id"] = "3100********1234"
	managedCreate[domain.OrganizationContact](t, app, admin, org+"/contacts", contact)
	qualification := map[string]any{"code": "auth", "name": "原厂授权", "vendor_id": vendor.ID, "manufacturer_id": mfr.ID, "kind": "oem_authorization", "certificate_type": "authorization", "certificate_no": "OEM-1", "valid_from": "2026-01-01", "valid_until": "2026-12-31", "evidence_ref": "qualification-case-1"}
	cert := managedCreate[domain.VendorQualification](t, app, admin, org+"/qualifications", qualification)
	qualification["certificate_no"] = "OEM-2"
	certURL := org + "/qualifications/" + cert.ID.String()
	expectCode(t, call(t, app, "PUT", certURL, admin, map[string]any{"expected_version": 1, "data": qualification}), 200, response.CodeSuccess)
	history := call(t, app, "GET", certURL+"/history", admin, nil)
	expectCode(t, history, 200, response.CodeSuccess)
	versions := decode[response.PageData[domain.ManagedAudit]](t, history.Data)
	if versions.Total != 2 || versions.Items[0].Before.Data().Qualification.CertificateNo != "OEM-1" || versions.Items[0].After.Data().Qualification.CertificateNo != "OEM-2" {
		t.Fatalf("qualification history not preserved: %+v", versions)
	}
	expectCode(t, call(t, app, "DELETE", certURL+"?expected_version=2", admin, nil), 409, response.CodeResourceConflict)
}
