package bootstrap

import (
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
