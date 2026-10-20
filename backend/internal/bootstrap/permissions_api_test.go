package bootstrap

import (
	"slices"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func findPermission(nodes []domain.Permission, code string) *domain.Permission {
	for i := range nodes {
		if nodes[i].Code == code {
			return &nodes[i]
		}
		if found := findPermission(nodes[i].Children, code); found != nil {
			return found
		}
	}
	return nil
}

func TestPermissionTreeKeepsNestedChildrenInOrder(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	mk := func(code string, parent *uuid.UUID, order int) uuid.UUID {
		p := domain.Permission{Code: code, Name: code, Type: domain.PermTypeMenu, ParentID: parent, SortOrder: order}
		if err := container.DB.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	root := mk("t-root", nil, 1)
	mid := mk("t-mid", &root, 1)
	mk("t-leaf-b", &mid, 2)
	mk("t-leaf-a", &mid, 1)
	r := call(t, app, "GET", "/api/v1/permissions", bearer, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	tree := decode[[]domain.Permission](t, r.Data)
	rootNode := findPermission(tree, "t-root")
	if rootNode == nil || len(rootNode.Children) != 1 || rootNode.Children[0].Code != "t-mid" {
		t.Fatalf("root children lost: %+v", rootNode)
	}
	leaves := rootNode.Children[0].Children
	if len(leaves) != 2 || leaves[0].Code != "t-leaf-a" || leaves[1].Code != "t-leaf-b" {
		t.Fatalf("leaf level lost or unordered: %+v", leaves)
	}
}

func permissionIDs(t *testing.T, container *AppContainer, codes ...string) []uuid.UUID {
	t.Helper()
	var perms []domain.Permission
	if err := container.DB.Where("code IN ?", codes).Find(&perms).Error; err != nil {
		t.Fatal(err)
	}
	if len(perms) != len(codes) {
		t.Fatalf("expected %d permissions, found %d", len(codes), len(perms))
	}
	ids := make([]uuid.UUID, 0, len(perms))
	for _, p := range perms {
		ids = append(ids, p.ID)
	}
	return ids
}

func TestNonAdminRoleIsLimitedToAssignedAPIsAndSeesItsCodes(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	role := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "auditor", "name": "审计员"}).Data)
	readOnly := permissionIDs(t, container, "users", domain.APIPermissionCode("GET", "/api/v1/users"), domain.APIPermissionCode("GET", "/api/v1/users/:id"))
	expectCode(t, call(t, app, "POST", "/api/v1/roles/"+role.ID.String()+"/permissions", bearer, map[string]any{"permission_ids": readOnly}), 200, response.CodeSuccess)
	createLocalUser(t, app, bearer, "aud", map[string]any{"role_ids": []uuid.UUID{role.ID}})
	aud := tokenFor(t, app, "aud", "Str0ng!pass")
	expectCode(t, call(t, app, "GET", "/api/v1/users", aud, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "POST", "/api/v1/users", aud, map[string]any{"username": "newbie1", "email": "newbie1@x.com", "password": "Str0ng!pass"}), 403, response.CodePermissionDenied)
	expectCode(t, call(t, app, "GET", "/api/v1/roles", aud, nil), 403, response.CodePermissionDenied)
	me := decode[domain.CurrentUser](t, call(t, app, "GET", "/api/v1/auth/me", aud, nil).Data)
	if me.IsAdmin || !slices.Contains(me.Permissions, "users") || !slices.Contains(me.Permissions, "org") || slices.Contains(me.Permissions, "users:create") {
		t.Fatalf("effective codes must include granted nodes and their ancestors only: %v", me.Permissions)
	}
	withCreate := append(readOnly, permissionIDs(t, container, "users:create", domain.APIPermissionCode("POST", "/api/v1/users"))...)
	expectCode(t, call(t, app, "POST", "/api/v1/roles/"+role.ID.String()+"/permissions", bearer, map[string]any{"permission_ids": withCreate}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "POST", "/api/v1/users", aud, map[string]any{"username": "newbie2", "email": "newbie2@x.com", "password": "Str0ng!pass"}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "PUT", "/api/v1/roles/"+role.ID.String(), bearer, map[string]any{"status": 2}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "GET", "/api/v1/users", aud, nil), 403, response.CodePermissionDenied)
	admin := decode[domain.CurrentUser](t, call(t, app, "GET", "/api/v1/auth/me", bearer, nil).Data)
	if !admin.IsAdmin || len(admin.Permissions) != 1 || admin.Permissions[0] != domain.AllPermissions {
		t.Fatalf("admin profile: %+v %v", admin.IsAdmin, admin.Permissions)
	}
}

func TestPermissionCRUDRespectsBuiltinLocksAndTree(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	menu := call(t, app, "POST", "/api/v1/permissions", bearer, map[string]any{"code": "reports", "name": "报表中心", "type": "menu", "path": "/reports"})
	expectCode(t, menu, 200, response.CodeSuccess)
	menuID := decode[domain.Permission](t, menu.Data).ID
	expectCode(t, call(t, app, "POST", "/api/v1/permissions", bearer, map[string]any{"code": "reports:bad", "name": "缺路径", "type": "api", "parent_id": menuID}), 400, response.CodeParamInvalid)
	api := call(t, app, "POST", "/api/v1/permissions", bearer, map[string]any{"code": "api:GET:/api/v1/reports", "name": "报表列表", "type": "api", "path": "/api/v1/reports", "method": "GET", "parent_id": menuID})
	expectCode(t, api, 200, response.CodeSuccess)
	apiID := decode[domain.Permission](t, api.Data).ID
	expectCode(t, call(t, app, "PUT", "/api/v1/permissions/"+menuID.String(), bearer, map[string]any{"code": "reports", "name": "报表中心", "type": "menu", "parent_id": apiID}), 400, response.CodeParamInvalid)
	expectCode(t, call(t, app, "DELETE", "/api/v1/permissions/"+menuID.String(), bearer, nil), 409, response.CodePermissionHasChildren)
	var builtin domain.Permission
	container.DB.First(&builtin, "code = ?", "users:create")
	locked := map[string]any{"code": "users:create2", "name": "新建用户", "type": "button", "parent_id": builtin.ParentID}
	expectCode(t, call(t, app, "PUT", "/api/v1/permissions/"+builtin.ID.String(), bearer, locked), 403, response.CodeBuiltinProtected)
	renamed := map[string]any{"code": "users:create", "name": "创建账号", "type": "button", "parent_id": builtin.ParentID, "sort_order": 5}
	expectCode(t, call(t, app, "PUT", "/api/v1/permissions/"+builtin.ID.String(), bearer, renamed), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "DELETE", "/api/v1/permissions/"+builtin.ID.String(), bearer, nil), 403, response.CodeBuiltinProtected)
	expectCode(t, call(t, app, "DELETE", "/api/v1/permissions/"+apiID.String(), bearer, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "DELETE", "/api/v1/permissions/"+menuID.String(), bearer, nil), 200, response.CodeSuccess)
}

func TestSyncRoutesRegistersNewAPIsAndRepairsPolicyDrift(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	app.Get("/api/v1/reports/daily", func(c fiber.Ctx) error { return c.SendStatus(200) })
	r := call(t, app, "POST", "/api/v1/permissions/sync", bearer, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	report := decode[domain.RouteSyncReport](t, r.Data)
	if report.Created != 1 || report.CreatedRoutes[0].Path != "/api/v1/reports/daily" || report.Existing != report.Discovered-1 {
		t.Fatalf("sync report: %+v", report)
	}
	var created domain.Permission
	container.DB.First(&created, "code = ?", domain.APIPermissionCode("GET", "/api/v1/reports/daily"))
	var group domain.Permission
	container.DB.First(&group, "id = ?", created.ParentID)
	if group.Code != "api-unclassified" {
		t.Fatalf("unmatched module should land in the unclassified group, got %q", group.Code)
	}
	if again := decode[domain.RouteSyncReport](t, call(t, app, "POST", "/api/v1/permissions/sync", bearer, nil).Data); again.Created != 0 {
		t.Fatalf("second sync must be idempotent: %+v", again)
	}
	role := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "ops", "name": "运维"}).Data)
	expectCode(t, call(t, app, "POST", "/api/v1/roles/"+role.ID.String()+"/permissions", bearer, map[string]any{"permission_ids": permissionIDs(t, container, domain.APIPermissionCode("GET", "/api/v1/users"))}), 200, response.CodeSuccess)
	container.DB.Exec("DELETE FROM sys_role_permissions WHERE role_id = ?", role.ID)
	drift := decode[domain.RouteSyncReport](t, call(t, app, "POST", "/api/v1/permissions/sync", bearer, nil).Data)
	if drift.PoliciesRemoved != 1 {
		t.Fatalf("stale policy not removed: %+v", drift)
	}
}

func TestRoleListShowsActiveMemberCounts(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	role := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "support", "name": "客服"}).Data)
	createLocalUser(t, app, bearer, "sup1", map[string]any{"role_ids": []uuid.UUID{role.ID}})
	gone := createLocalUser(t, app, bearer, "sup2", map[string]any{"role_ids": []uuid.UUID{role.ID}})
	expectCode(t, call(t, app, "DELETE", "/api/v1/users/"+gone.ID.String(), bearer, nil), 200, response.CodeSuccess)
	page := decode[response.PageData[domain.Role]](t, call(t, app, "GET", "/api/v1/roles?keyword=客服", bearer, nil).Data)
	if page.Total != 1 || page.Items[0].UserCount != 1 {
		t.Fatalf("user_count must ignore deleted users: %+v", page.Items)
	}
	all := decode[response.PageData[domain.Role]](t, call(t, app, "GET", "/api/v1/roles", bearer, nil).Data)
	if all.Items[0].Code != "admin" || all.Items[0].UserCount != 1 {
		t.Fatalf("built-in admin first with one member: %+v", all.Items[0])
	}
}
