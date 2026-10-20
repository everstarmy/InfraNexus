package bootstrap

import (
	"testing"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func TestUserListFiltersByRole(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	var adminRole domain.Role
	if err := container.DB.First(&adminRole, "code = ?", "admin").Error; err != nil {
		t.Fatal(err)
	}
	call(t, app, "POST", "/api/v1/users", bearer, map[string]any{"username": "plain", "email": "plain@x.com", "password": "Str0ng!pass"})
	r := call(t, app, "GET", "/api/v1/users?role_id="+adminRole.ID.String(), bearer, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	page := decode[response.PageData[domain.User]](t, r.Data)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Username != "admin" {
		t.Fatalf("role filter returned %+v", page)
	}
}

func TestUserInputValidationIsEnforced(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	r := call(t, app, "POST", "/api/v1/users", bearer, map[string]any{"username": "ab", "email": "ab@x.com", "password": "Str0ng!pass"})
	expectCode(t, r, 400, response.CodeParamInvalid)
	var count int64
	container.DB.Model(&domain.User{}).Where("username = ?", "ab").Count(&count)
	if count != 0 {
		t.Fatal("invalid user was persisted despite validation failure")
	}
	var admin domain.User
	container.DB.First(&admin, "username = ?", "admin")
	r = call(t, app, "PATCH", "/api/v1/users/"+admin.ID.String()+"/status", bearer, map[string]any{"status": 7})
	expectCode(t, r, 400, response.CodeParamInvalid)
	container.DB.First(&admin, "id = ?", admin.ID)
	if admin.Status != 1 {
		t.Fatalf("invalid status persisted: %d", admin.Status)
	}
}

func TestAdminCannotLockThemselvesOut(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	var admin domain.User
	container.DB.First(&admin, "username = ?", "admin")
	expectCode(t, call(t, app, "PATCH", "/api/v1/users/"+admin.ID.String()+"/status", bearer, map[string]any{"status": 2}), 403, response.CodeSelfOperationDenied)
	expectCode(t, call(t, app, "PUT", "/api/v1/users/"+admin.ID.String(), bearer, map[string]any{"status": 2}), 403, response.CodeSelfOperationDenied)
	expectCode(t, call(t, app, "DELETE", "/api/v1/users/"+admin.ID.String(), bearer, nil), 403, response.CodeSelfOperationDenied)
	expectCode(t, call(t, app, "GET", "/api/v1/auth/me", bearer, nil), 200, response.CodeSuccess)
}

func TestBuiltinAdminAccountIsProtectedFromOtherAdmins(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	var adminRole domain.Role
	container.DB.First(&adminRole, "code = ?", "admin")
	r := call(t, app, "POST", "/api/v1/users", bearer, map[string]any{"username": "ops", "email": "ops@x.com", "password": "Str0ng!pass", "role_ids": []string{adminRole.ID.String()}})
	expectCode(t, r, 200, response.CodeSuccess)
	ops := tokenFor(t, app, "ops", "Str0ng!pass")
	var admin domain.User
	container.DB.First(&admin, "username = ?", "admin")
	expectCode(t, call(t, app, "PATCH", "/api/v1/users/"+admin.ID.String()+"/status", ops, map[string]any{"status": 2}), 403, response.CodeBuiltinProtected)
	expectCode(t, call(t, app, "DELETE", "/api/v1/users/"+admin.ID.String(), ops, nil), 403, response.CodeBuiltinProtected)
	expectCode(t, call(t, app, "PUT", "/api/v1/users/"+admin.ID.String(), ops, map[string]any{"role_ids": []string{}}), 403, response.CodeBuiltinProtected)
	expectCode(t, call(t, app, "GET", "/api/v1/users", bearer, nil), 200, response.CodeSuccess)
}

func TestDeletedUsernameCanBeReusedAndDuplicatesConflict(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	body := map[string]any{"username": "bobby", "email": "bob@x.com", "password": "Str0ng!pass"}
	first := call(t, app, "POST", "/api/v1/users", bearer, body)
	expectCode(t, first, 200, response.CodeSuccess)
	expectCode(t, call(t, app, "POST", "/api/v1/users", bearer, body), 409, response.CodeResourceConflict)
	id := decode[domain.User](t, first.Data).ID
	expectCode(t, call(t, app, "DELETE", "/api/v1/users/"+id.String(), bearer, nil), 200, response.CodeSuccess)
	second := call(t, app, "POST", "/api/v1/users", bearer, body)
	expectCode(t, second, 200, response.CodeSuccess)
	if decode[domain.User](t, second.Data).ID == id {
		t.Fatal("recreated user reused the deleted row")
	}
}
