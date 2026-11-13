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

func createTestLocation(t *testing.T, app *fiber.App, token, kind, name string, parent *uuid.UUID, ext map[string]any) domain.LocationNode {
	t.Helper()
	return managedCreate[domain.LocationNode](t, app, token, "/api/v1/locations/nodes", map[string]any{"name": name, "type": kind, "parent": parent, "ext": ext})
}

func TestManagementLocationsAndRolePermissions(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	const locations = "/api/v1/locations"
	center := createTestLocation(t, app, admin, "datacenter", "主中心", nil, map[string]any{"address": "测试地址", "contact": map[string]any{"name": "联系人"}})
	building := createTestLocation(t, app, admin, "building", "一号楼", &center.UID, map[string]any{})
	room := createTestLocation(t, app, admin, "room", "一号机房", &building.UID, map[string]any{"floor": 0})
	rackExt := map[string]any{"row": "A", "column": 1, "height_u": 42}
	rack := createTestLocation(t, app, admin, "rack", "一号机柜", &room.UID, rackExt)
	rackURL := locations + "/nodes/" + rack.UID.String()
	units := call(t, app, "GET", rackURL+"/units", admin, nil)
	expectCode(t, units, 200, response.CodeSuccess)
	view := decode[domain.RackUnitView](t, units.Data)
	if len(view.Units) != 42 || view.Units[0].Unit != 42 || view.Units[0].State != "free" {
		t.Fatalf("unexpected rack view: %+v", view)
	}
	occupied := domain.RackUnitAllocation{RackID: rack.UID, Unit: 42, SubjectID: uuid.New(), State: "reserved"}
	if err := container.DB.Create(&occupied).Error; err != nil {
		t.Fatal(err)
	}
	edit := map[string]any{"name": rack.Name, "version": 1, "ext": rackExt}
	rackExt["height_u"] = 40
	expectCode(t, call(t, app, "PUT", rackURL, admin, edit), 409, response.CodeResourceConflict)
	rackExt["height_u"] = 48
	expectCode(t, call(t, app, "PUT", rackURL, admin, edit), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "PUT", rackURL, admin, edit), 409, response.CodeResourceConflict)
	centerURL := locations + "/nodes/" + center.UID.String()
	expectCode(t, call(t, app, "DELETE", centerURL+"?version=1", admin, nil), 409, response.CodeResourceConflict)
	expectCode(t, call(t, app, "PATCH", centerURL+"/status", admin, map[string]any{"version": 1, "status": 2}), 409, response.CodeResourceConflict)
	history := call(t, app, "GET", rackURL+"/history", admin, nil)
	expectCode(t, history, 200, response.CodeSuccess)
	audit := decode[response.PageData[domain.ManagedAudit]](t, history.Data)
	if audit.Total != 2 || audit.Items[0].After.Data().Version != 2 || audit.Items[0].ActorID == uuid.Nil || audit.Items[0].RequestID == "" {
		t.Fatalf("unexpected rack audit: %+v", audit)
	}

	otherCenter := createTestLocation(t, app, admin, "datacenter", "异地中心", nil, map[string]any{"address": "地址", "contact": map[string]any{"name": "联系人"}})
	otherBuilding := createTestLocation(t, app, admin, "building", "异地楼栋", &otherCenter.UID, map[string]any{})
	expectCode(t, call(t, app, "PUT", locations+"/nodes/"+room.UID.String(), admin, map[string]any{"version": 1, "name": room.Name, "parent": otherBuilding.UID, "ext": map[string]int{"floor": 0}}), 400, response.CodeParamInvalid)
	if err := container.DB.Model(&room).Update("parent", otherBuilding.UID).Error; err == nil {
		t.Fatal("database allowed a location parent change")
	}

	zone := managedCreate[domain.SecurityZone](t, app, admin, "/api/v1/ipam/security-zones",
		map[string]any{"name": "同中心安全域", "datacenter_id": center.UID})
	otherZone := managedCreate[domain.SecurityZone](t, app, admin, "/api/v1/ipam/security-zones",
		map[string]any{"name": "异地安全域", "datacenter_id": otherCenter.UID})
	expectCode(t, call(t, app, "PUT", rackURL+"/security-zone", admin, map[string]any{"version": 2, "security_zone_id": otherZone.ID}), 409, response.CodeResourceConflict)
	expectCode(t, call(t, app, "PUT", rackURL+"/security-zone", admin, map[string]any{"version": 2, "security_zone_id": zone.ID}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "PATCH", "/api/v1/ipam/security-zones/"+zone.ID.String()+"/status", admin,
		map[string]any{"expected_version": 1, "status": 2}), 409, response.CodeResourceConflict)

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
	read := permissionIDs(t, container, "locations:nodes:type:datacenter", domain.APIPermissionCode("GET", locations+"/nodes"), domain.APIPermissionCode("GET", "/api/v1/ipam/subnets"), domain.APIPermissionCode("GET", "/api/v1/vendor-management/companies"))
	expectCode(t, assignRolePermissions(t, app, admin, role.ID, read), 200, response.CodeSuccess)
	createLocalUser(t, app, admin, "dcim-reader", map[string]any{"role_ids": []uuid.UUID{role.ID}})
	reader := tokenFor(t, app, "dcim-reader", "Str0ng!pass")
	for _, path := range []string{locations + "/nodes", "/api/v1/ipam/subnets", "/api/v1/vendor-management/companies"} {
		expectCode(t, call(t, app, "GET", path, reader, nil), 200, response.CodeSuccess)
		expectCode(t, call(t, app, "POST", path, reader, map[string]any{}), 403, response.CodePermissionDenied)
	}
	readResult := call(t, app, "GET", locations+"/nodes/search", admin, nil)
	expectCode(t, readResult, 200, response.CodeSuccess)
	found := false
	for _, node := range decode[response.PageData[domain.LocationNode]](t, readResult.Data).Items {
		if node.UID == rack.UID && bytes.Contains(node.Path, []byte(center.Name)) {
			found = true
		}
	}
	if !found {
		t.Fatal("rack search result is missing its ancestor path")
	}
	expectCode(t, call(t, app, "GET", rackURL+"/history", reader, nil), 403, response.CodePermissionDenied)
}

func TestManagementIPAMIsolationReservationAndConflict(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	const ipam = "/api/v1/ipam"
	center := createTestLocation(t, app, admin, "datacenter", "机房", nil, map[string]any{"address": "测试地址", "contact": map[string]any{"name": "联系人"}})
	zone := managedCreate[domain.SecurityZone](t, app, admin, ipam+"/security-zones", map[string]any{"name": "生产", "datacenter_id": center.UID})
	scope := managedCreate[domain.NetworkScope](t, app, admin, ipam+"/network-scopes", map[string]any{"name": "VRF A"})
	scopeB := managedCreate[domain.NetworkScope](t, app, admin, ipam+"/network-scopes", map[string]any{"name": "VRF B"})
	fields := func(name, cidr string, id uuid.UUID) map[string]any {
		return map[string]any{
			"name": name, "network_scope_id": id, "security_zone_id": zone.ID, "cidr": cidr, "usage_type": "bmc", "is_allocatable": true,
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
	for _, name := range []string{"race-a", "race-b"} {
		wg.Go(func() { out <- call(t, app, "POST", ipam+"/subnets", admin, fields(name, "10.1.0.0/24", scope.ID)) })
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

func TestManagementCompanyProfiles(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	const root = "/api/v1/vendor-management"
	const companies = root + "/companies"
	const contacts = root + "/company-contacts"
	create := func(name string, kind int) domain.Company {
		return managedCreate[domain.Company](t, app, admin, companies, map[string]any{"name": name, "type": kind})
	}
	manufacturer := create("mfr-a", 1)
	supplier := create("supplier-a", 2)
	both := create("both-a", 3)
	for _, filter := range []struct {
		kind string
		want []uuid.UUID
	}{
		{"1", []uuid.UUID{both.ID, manufacturer.ID}},
		{"2", []uuid.UUID{both.ID, supplier.ID}},
		{"3", []uuid.UUID{both.ID}},
	} {
		result := call(t, app, "GET", companies+"?type="+filter.kind, admin, nil)
		expectCode(t, result, 200, response.CodeSuccess)
		page := decode[response.PageData[domain.Company]](t, result.Data)
		if len(page.Items) != len(filter.want) {
			t.Fatalf("wrong companies for type %s: %+v", filter.kind, page)
		}
		for i, id := range filter.want {
			if page.Items[i].ID != id {
				t.Fatalf("wrong company ID for type %s", filter.kind)
			}
		}
	}
	for _, owner := range []uuid.UUID{manufacturer.ID, both.ID} {
		for range 2 {
			managedCreate[domain.CompanyContact](t, app, admin, contacts, map[string]any{"name": "联系人", "company_id": owner, "title": "经理", "description": "工作日联系"})
		}
		result := call(t, app, "GET", contacts+"?parent_id="+owner.String(), admin, nil)
		expectCode(t, result, 200, response.CodeSuccess)
		page := decode[response.PageData[domain.CompanyContact]](t, result.Data)
		if page.Total != 2 || page.Items[0].CompanyID != owner || page.Items[0].Title != "经理" {
			t.Fatalf("wrong contacts: %+v", page)
		}
	}
	expectCode(t, call(t, app, "POST", companies, admin, map[string]any{"name": "invalid", "type": 4}), 400, response.CodeParamInvalid)
	expectCode(t, call(t, app, "DELETE", companies+"/"+both.ID.String()+"?expected_version=1", admin, nil), 409, response.CodeResourceConflict)
	companyURL := companies + "/" + both.ID.String()
	stopped := call(t, app, "PATCH", companyURL+"/status", admin, map[string]any{"expected_version": 1, "status": domain.StatusDisabled})
	expectCode(t, stopped, 200, response.CodeSuccess)
	if company := decode[domain.Company](t, stopped.Data); company.Status != domain.StatusDisabled || company.Version != 2 {
		t.Fatalf("unexpected company after disabling: %+v", company)
	}
	list := call(t, app, "GET", contacts+"?parent_id="+both.ID.String(), admin, nil)
	expectCode(t, list, 200, response.CodeSuccess)
	page := decode[response.PageData[domain.CompanyContact]](t, list.Data)
	if page.Total != 2 || len(page.Items) != 2 {
		t.Fatalf("company lost contacts after disabling: %+v", page)
	}
	for _, contact := range page.Items {
		if contact.CompanyID != both.ID || contact.Status != domain.StatusEnabled {
			t.Fatalf("company disable changed contact: %+v", contact)
		}
	}
	expectCode(t, call(t, app, "DELETE", companyURL+"?expected_version=2", admin, nil), 409, response.CodeResourceConflict)
	expectCode(t, call(t, app, "PATCH", companyURL+"/status", admin, map[string]any{"expected_version": 2, "status": domain.StatusEnabled}), 200, response.CodeSuccess)
	for _, table := range []string{"org_manufacturer", "org_vendor", "org_contact"} {
		if container.DB.Migrator().HasTable(table) {
			t.Errorf("unexpected old table %s", table)
		}
	}
}
