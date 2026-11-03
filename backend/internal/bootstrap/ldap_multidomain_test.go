package bootstrap

import (
	"slices"
	"testing"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func TestMultipleDirectoryDomainsKeepLoginAndSyncPoliciesIndependent(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	srv := startDirectory(t)
	first := createDirectory(t, app, bearer, directoryRequest(srv, nil))
	second := createDirectory(t, app, bearer, directoryRequest(srv, map[string]any{
		"name": "分部 AD", "domain": "branch.local", "sync_enabled": true,
	}))

	login := func(domainName string) apiResult {
		return call(t, app, "POST", "/api/v1/auth/token", "", map[string]string{
			"domain": domainName, "username": "zhangsan", "password": "Pa55!word",
		})
	}
	for _, cfg := range []domain.LDAPConfig{first, second} {
		expectCode(t, login(cfg.Domain), 200, response.CodeSuccess)
	}
	var users []domain.User
	if err := container.DB.Where("username = ?", "zhangsan").Find(&users).Error; err != nil {
		t.Fatal(err)
	}
	if len(users) != 2 || users[0].ID == users[1].ID || users[0].Domain == users[1].Domain {
		t.Fatalf("same username must have independent profiles in each domain: %+v", users)
	}

	setLogin := func(enabled bool) {
		t.Helper()
		body := directoryRequest(srv, map[string]any{
			"name": second.Name, "domain": second.Domain, "enabled": enabled,
			"sync_enabled": true, "bind_password": "",
		})
		expectCode(t, call(t, app, "PUT", "/api/v1/ldap/configs/"+second.ID.String(), bearer, body), 200, response.CodeSuccess)
	}
	setLogin(false)
	domains := decode[[]domain.AuthDomain](t, call(t, app, "GET", "/api/v1/auth/domains", "", nil).Data)
	if len(domains) != 1 || domains[0].Domain != first.Domain {
		t.Fatalf("disabled domain must not appear in login choices: %+v", domains)
	}
	expectCode(t, login(second.Domain), 400, response.CodeDomainNotFound)
	web := doAuth(t, app, "POST", "/api/v1/auth/login",
		`{"domain":"branch.local","username":"zhangsan","password":"Pa55!word"}`,
		"http://localhost:5173", "", nil)
	webResult := readAuth(t, web)
	if web.StatusCode != 400 || webResult.Code != response.CodeDomainNotFound {
		t.Fatalf("disabled Web domain login: status=%d code=%d", web.StatusCode, webResult.Code)
	}
	expectCode(t, login(first.Domain), 200, response.CodeSuccess)
	stored := decode[domain.LDAPConfig](t, call(t, app, "GET", "/api/v1/ldap/configs/"+second.ID.String(), bearer, nil).Data)
	if stored.Enabled || !stored.SyncEnabled {
		t.Fatalf("disabling login must preserve scheduled sync: %+v", stored)
	}
	// A login-disabled domain can still preview directory changes.
	expectCode(t, call(t, app, "POST", "/api/v1/ldap/preview", bearer, map[string]any{
		"config_id": second.ID, "mode": domain.SyncModeFull,
	}), 200, response.CodeSuccess)

	setLogin(true)
	domains = decode[[]domain.AuthDomain](t, call(t, app, "GET", "/api/v1/auth/domains", "", nil).Data)
	if len(domains) != 2 {
		t.Fatalf("re-enabled domain must return to login choices: %+v", domains)
	}
	expectCode(t, login(second.Domain), 200, response.CodeSuccess)
}

func TestDirectoryStatusPermissionHasIndependentCatalogueAndGrant(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	srv := startDirectory(t)
	cfg := createDirectory(t, app, admin, directoryRequest(srv, nil))
	tree := decode[[]domain.Permission](t, call(t, app, "GET", "/api/v1/permissions", admin, nil).Data)
	button := findPermission(tree, "ldap:toggle-status")
	apiCode := domain.APIPermissionCode("PATCH", "/api/v1/ldap/configs/:id/status")
	if button == nil || button.Name != "变更域登录状态" || button.Type != domain.PermTypeButton {
		t.Fatalf("status button missing from permission catalogue: %+v", button)
	}
	api := findPermission(button.Children, apiCode)
	if api == nil || api.Method != "PATCH" || api.Path != "/api/v1/ldap/configs/:id/status" {
		t.Fatalf("status API must be attached to its dedicated button: %+v", api)
	}

	role := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", admin, map[string]any{"code": "directory-editor", "name": "目录编辑者"}).Data)
	ids := permissionIDs(t, container, "ldap:update", domain.APIPermissionCode("GET", "/api/v1/ldap/configs"), domain.APIPermissionCode("PUT", "/api/v1/ldap/configs/:id"))
	expectCode(t, assignRolePermissions(t, app, admin, role.ID, ids), 200, response.CodeSuccess)
	createLocalUser(t, app, admin, "directory-editor", map[string]any{"role_ids": []string{role.ID.String()}})
	editor := tokenFor(t, app, "directory-editor", "Str0ng!pass")
	// Existing editors keep the full configuration editor; a new route is not
	// silently granted to every role merely because it shares the menu.
	expectCode(t, call(t, app, "PUT", "/api/v1/ldap/configs/"+cfg.ID.String(), editor, directoryRequest(srv, nil)), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "PATCH", "/api/v1/ldap/configs/"+cfg.ID.String()+"/status", editor, map[string]any{"enabled": false}), 403, response.CodePermissionDenied)
	ids = append(ids, permissionIDs(t, container, apiCode)...)
	expectCode(t, assignRolePermissions(t, app, admin, role.ID, ids), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "PATCH", "/api/v1/ldap/configs/"+cfg.ID.String()+"/status", editor, map[string]any{"enabled": false}), 200, response.CodeSuccess)
	me := decode[domain.CurrentUser](t, call(t, app, "GET", "/api/v1/auth/me", editor, nil).Data)
	if !slices.Contains(me.Permissions, "ldap:toggle-status") {
		t.Fatal("granting the API must expose its button ancestor in effective permissions")
	}
}

func TestDirectoryStatusPermissionSeedUpgradePreservesExistingGrant(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	admin := adminToken(t, app)
	apiCode := domain.APIPermissionCode("PATCH", "/api/v1/ldap/configs/:id/status")
	var api, editor domain.Permission
	if err := container.DB.First(&api, "code = ?", apiCode).Error; err != nil {
		t.Fatal(err)
	}
	if err := container.DB.First(&editor, "code = ?", "ldap:update").Error; err != nil {
		t.Fatal(err)
	}
	role := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", admin, map[string]any{"code": "directory-status", "name": "域状态维护者"}).Data)
	expectCode(t, assignRolePermissions(t, app, admin, role.ID, permissionIDs(t, container, apiCode)), 200, response.CodeSuccess)
	if err := container.DB.Model(&api).Updates(map[string]any{"parent_id": editor.ID, "name": "切换目录启用状态"}).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := Seed(container.DB, container.Logger); err != nil {
			t.Fatal(err)
		}
	}
	var upgraded domain.Permission
	if err := container.DB.First(&upgraded, "id = ?", api.ID).Error; err != nil {
		t.Fatal(err)
	}
	var button domain.Permission
	if err := container.DB.First(&button, "code = ?", "ldap:toggle-status").Error; err != nil {
		t.Fatal(err)
	}
	if upgraded.ParentID == nil || *upgraded.ParentID != button.ID || upgraded.Name != "切换域账号登录状态" {
		t.Fatalf("legacy status API was not reparented/renamed: %+v", upgraded)
	}
	var grants int64
	if err := container.DB.Table("sys_role_permissions").Where("role_id = ? AND permission_id = ?", role.ID, api.ID).Count(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if grants != 1 {
		t.Fatalf("seed upgrade changed existing role grant: count=%d", grants)
	}
}
