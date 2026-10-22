package bootstrap

import (
	"fmt"
	"testing"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func TestBuiltinAdminRoleIsProtected(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	var adminRole domain.Role
	container.DB.First(&adminRole, "code = ?", "admin")
	expectCode(t, call(t, app, "DELETE", "/api/v1/roles/"+adminRole.ID.String(), bearer, nil), 403, response.CodeBuiltinProtected)
	expectCode(t, call(t, app, "PUT", "/api/v1/roles/"+adminRole.ID.String(), bearer, map[string]any{"status": 2}), 403, response.CodeBuiltinProtected)
	expectCode(t, call(t, app, "GET", "/api/v1/users", bearer, nil), 200, response.CodeSuccess)
}

func TestRoleCreateValidationAndCodeReuse(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	expectCode(t, call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "", "name": ""}), 400, response.CodeParamInvalid)
	var count int64
	container.DB.Model(&domain.Role{}).Where("code = ?", "").Count(&count)
	if count != 0 {
		t.Fatal("role with empty code persisted")
	}
	body := map[string]any{"code": "auditor", "name": "审计员"}
	created := call(t, app, "POST", "/api/v1/roles", bearer, body)
	expectCode(t, created, 200, response.CodeSuccess)
	expectCode(t, call(t, app, "POST", "/api/v1/roles", bearer, body), 409, response.CodeResourceConflict)
	id := decode[domain.Role](t, created.Data).ID
	expectCode(t, call(t, app, "DELETE", "/api/v1/roles/"+id.String(), bearer, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "POST", "/api/v1/roles", bearer, body), 200, response.CodeSuccess)
}

func TestRolePermissionAssignmentRejectsStaleRevision(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	created := call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "revision-check", "name": "并发校验"})
	expectCode(t, created, 200, response.CodeSuccess)
	role := decode[domain.Role](t, created.Data)
	path := "/api/v1/roles/" + role.ID.String() + "/permissions"

	expectCode(t, call(t, app, "POST", path, bearer, map[string]any{"permission_ids": []string{}}), 400, response.CodeParamInvalid)
	expectCode(t, call(t, app, "POST", path, bearer, map[string]any{"permission_ids": []string{}, "expected_revision": role.EditRevision}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "POST", path, bearer, map[string]any{"permission_ids": []string{}, "expected_revision": role.EditRevision}), 409, response.CodeResourceConflict)
}

func TestRoleStatusUsesCompareAndSetRevision(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	created := call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "status-cas", "name": "状态并发校验"})
	expectCode(t, created, 200, response.CodeSuccess)
	role := decode[domain.Role](t, created.Data)
	path := "/api/v1/roles/" + role.ID.String() + "/status"
	disabled := call(t, app, "PATCH", path, bearer, map[string]any{"status": 2, "expected_revision": role.EditRevision})
	expectCode(t, disabled, 200, response.CodeSuccess)
	updated := decode[domain.Role](t, disabled.Data)
	if updated.Status != domain.StatusDisabled || updated.EditRevision != role.EditRevision+1 {
		t.Fatalf("status update was not versioned: status=%d revision=%d", updated.Status, updated.EditRevision)
	}
	expectCode(t, call(t, app, "PATCH", path, bearer, map[string]any{"status": 1, "expected_revision": role.EditRevision}), 409, response.CodeResourceConflict)
	enabled := call(t, app, "PATCH", path, bearer, map[string]any{"status": 1, "expected_revision": updated.EditRevision})
	expectCode(t, enabled, 200, response.CodeSuccess)
}

func TestRoleServerPaginationFindsRolesBeyondFirstHundred(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	var seeded int64
	if err := container.DB.Model(&domain.Role{}).Count(&seeded).Error; err != nil {
		t.Fatal(err)
	}
	roles := make([]domain.Role, 150)
	for i := range roles {
		roles[i] = domain.Role{Code: fmt.Sprintf("m1-page-%03d", i), Name: fmt.Sprintf("M1 分页角色 %03d", i), Status: domain.StatusEnabled}
	}
	if err := container.DB.CreateInBatches(&roles, 50).Error; err != nil {
		t.Fatal(err)
	}
	lastPage := call(t, app, "GET", "/api/v1/roles?page=8&page_size=20", bearer, nil)
	expectCode(t, lastPage, 200, response.CodeSuccess)
	page := decode[response.PageData[domain.Role]](t, lastPage.Data)
	if page.Total != seeded+150 || page.Page != 8 || len(page.Items) != int(page.Total)-140 {
		t.Fatalf("unexpected role pagination metadata: total=%d page=%d items=%d", page.Total, page.Page, len(page.Items))
	}
	found := call(t, app, "GET", "/api/v1/roles?page=1&page_size=20&keyword=m1-page-149", bearer, nil)
	expectCode(t, found, 200, response.CodeSuccess)
	searchPage := decode[response.PageData[domain.Role]](t, found.Data)
	if searchPage.Total != 1 || len(searchPage.Items) != 1 || searchPage.Items[0].Code != "m1-page-149" {
		t.Fatalf("server search did not find role beyond first hundred: %+v", searchPage)
	}
}
