package bootstrap

import (
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

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

func createLocalUser(t *testing.T, app *fiber.App, bearer, username string, extra map[string]any) domain.User {
	t.Helper()
	body := map[string]any{"username": username, "email": username + "@x.com", "password": "Str0ng!pass"}
	for k, v := range extra {
		body[k] = v
	}
	r := call(t, app, "POST", "/api/v1/users", bearer, body)
	expectCode(t, r, 200, response.CodeSuccess)
	return decode[domain.User](t, r.Data)
}

func listUsers(t *testing.T, app *fiber.App, bearer, query string) response.PageData[domain.User] {
	t.Helper()
	r := call(t, app, "GET", "/api/v1/users?"+query, bearer, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	return decode[response.PageData[domain.User]](t, r.Data)
}

func TestBatchMoveAndDepartmentFilterIncludesChildren(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	hq := createDept(t, app, bearer, "总部", "hq", nil)
	rd := createDept(t, app, bearer, "研发中心", "rd", &hq.ID)
	frozen := createDept(t, app, bearer, "冻结部门", "frozen", nil)
	expectCode(t, call(t, app, "PUT", "/api/v1/departments/"+frozen.ID.String(), bearer, map[string]any{"name": "冻结部门", "code": "frozen", "status": 2}), 200, response.CodeSuccess)
	u1 := createLocalUser(t, app, bearer, "user1", nil)
	u2 := createLocalUser(t, app, bearer, "user2", nil)
	move := func(ids []uuid.UUID, target uuid.UUID) apiResult {
		return call(t, app, "POST", "/api/v1/users/batch-move-department", bearer, map[string]any{"user_ids": ids, "target_dept_id": target})
	}
	r := move([]uuid.UUID{u1.ID, u2.ID, u1.ID}, rd.ID)
	expectCode(t, r, 200, response.CodeSuccess)
	if decode[map[string]int](t, r.Data)["moved"] != 2 {
		t.Fatalf("moved count: %s", r.Data)
	}
	expectCode(t, move([]uuid.UUID{u1.ID}, frozen.ID), 409, response.CodeDepartmentInvalidParent)
	expectCode(t, move([]uuid.UUID{u1.ID, uuid.New()}, hq.ID), 404, response.CodeUserNotFound)
	expectCode(t, move([]uuid.UUID{}, hq.ID), 400, response.CodeParamInvalid)
	var stillInRD int64
	container.DB.Model(&domain.User{}).Where("department_id = ?", rd.ID).Count(&stillInRD)
	if stillInRD != 2 {
		t.Fatalf("failed batch moves must not partially apply, got %d in rd", stillInRD)
	}
	if page := listUsers(t, app, bearer, "department_id="+hq.ID.String()); page.Total != 0 {
		t.Fatalf("direct members of hq: %d", page.Total)
	}
	if page := listUsers(t, app, bearer, "department_id="+hq.ID.String()+"&include_children=true"); page.Total != 2 {
		t.Fatalf("subtree members of hq: %d", page.Total)
	}
	if page := listUsers(t, app, bearer, "department_id=none"); page.Total != 1 || page.Items[0].Username != "admin" {
		t.Fatalf("unassigned filter: %+v", page.Items)
	}
}

func TestResetPasswordEnforcesPolicyAndRevokesExistingSessions(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	carol := createLocalUser(t, app, bearer, "carol", nil)
	login := doAuth(t, app, "POST", "/api/v1/auth/login", `{"username":"carol","password":"Str0ng!pass"}`, "http://localhost:5173", "", nil)
	if login.StatusCode != 200 {
		t.Fatalf("carol login: %d", login.StatusCode)
	}
	cookie := login.Cookies()[0]
	readAuth(t, login)
	oldBearer := forgeIssuedAt(t, container, tokenFor(t, app, "carol", "Str0ng!pass"), time.Now().Add(-time.Minute))
	expectCode(t, call(t, app, "GET", "/api/v1/auth/me", oldBearer, nil), 200, response.CodeSuccess)
	reset := "/api/v1/users/" + carol.ID.String() + "/reset-password"
	expectCode(t, call(t, app, "POST", reset, bearer, map[string]any{"password": "weakpass"}), 400, response.CodePasswordTooWeak)
	expectCode(t, call(t, app, "POST", reset, bearer, map[string]any{"password": "N3w!Passw0rd"}), 200, response.CodeSuccess)
	res := doAuth(t, app, "GET", "/api/v1/auth/me", "", "", "", cookie)
	if env := readAuth(t, res); res.StatusCode != 401 || env.Code != response.CodeSessionRevoked {
		t.Fatalf("old cookie session survived reset: %d/%d", res.StatusCode, env.Code)
	}
	expectCode(t, call(t, app, "GET", "/api/v1/auth/me", oldBearer, nil), 401, response.CodeSessionRevoked)
	expectCode(t, call(t, app, "POST", "/api/v1/auth/token", "", map[string]string{"username": "carol", "password": "Str0ng!pass"}), 401, response.CodeInvalidCredentials)
	fresh := tokenFor(t, app, "carol", "N3w!Passw0rd")
	expectCode(t, call(t, app, "GET", "/api/v1/auth/me", fresh, nil), 200, response.CodeSuccess)
	adUser := domain.User{Username: "dave", Domain: "corp.local", AuthType: domain.AuthTypeAD, Status: 1}
	container.DB.Create(&adUser)
	expectCode(t, call(t, app, "POST", "/api/v1/users/"+adUser.ID.String()+"/reset-password", bearer, map[string]any{"password": "N3w!Passw0rd"}), 409, response.CodeExternalAccountManaged)
}

func TestAssignRolesStatsAndListFilters(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	auditor := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "auditor", "name": "审计员"}).Data)
	viewer := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "viewer", "name": "访客"}).Data)
	erin := createLocalUser(t, app, bearer, "erin", nil)
	r := call(t, app, "PUT", "/api/v1/users/"+erin.ID.String()+"/roles", bearer, map[string]any{"role_ids": []uuid.UUID{auditor.ID, viewer.ID}})
	expectCode(t, r, 200, response.CodeSuccess)
	if roles := decode[domain.User](t, r.Data).Roles; len(roles) != 2 {
		t.Fatalf("multi-role assignment: %+v", roles)
	}
	expectCode(t, call(t, app, "PUT", "/api/v1/users/"+erin.ID.String()+"/roles", bearer, map[string]any{"role_ids": []uuid.UUID{}}), 200, response.CodeSuccess)
	var admin domain.User
	container.DB.First(&admin, "username = ?", "admin")
	expectCode(t, call(t, app, "PUT", "/api/v1/users/"+admin.ID.String()+"/roles", bearer, map[string]any{"role_ids": []uuid.UUID{auditor.ID}}), 403, response.CodeBuiltinProtected)
	frank := createLocalUser(t, app, bearer, "frank", nil)
	expectCode(t, call(t, app, "PATCH", "/api/v1/users/"+frank.ID.String()+"/status", bearer, map[string]any{"status": 2}), 200, response.CodeSuccess)
	container.DB.Create(&domain.User{Username: "gina", Domain: "corp.local", AuthType: domain.AuthTypeAD, Status: 1})
	r = call(t, app, "GET", "/api/v1/users/stats", bearer, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	stats := decode[domain.UserStats](t, r.Data)
	if stats.Total != 4 || stats.Active != 3 || stats.Disabled != 1 || stats.Local != 3 || stats.Directory != 1 || stats.Unassigned != 4 {
		t.Fatalf("stats: %+v", stats)
	}
	if len(stats.ByDomain) != 1 || stats.ByDomain[0].Domain != "corp.local" || stats.ByDomain[0].Count != 1 {
		t.Fatalf("by_domain: %+v", stats.ByDomain)
	}
	if page := listUsers(t, app, bearer, "auth_type=ad"); page.Total != 1 || page.Items[0].Username != "gina" {
		t.Fatalf("auth_type filter: %+v", page.Items)
	}
	if page := listUsers(t, app, bearer, "status=1,2"); page.Total != 4 {
		t.Fatalf("multi status filter: %d", page.Total)
	}
	page := listUsers(t, app, bearer, "sort=username:asc")
	if page.Items[0].Username != "admin" || page.Items[len(page.Items)-1].Username != "gina" {
		t.Fatalf("sort by username asc: %v", page.Items)
	}
}

func TestSelfServiceAndOptionsNeedOnlyAuthentication(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	createLocalUser(t, app, bearer, "nobody", nil)
	plain := tokenFor(t, app, "nobody", "Str0ng!pass")
	expectCode(t, call(t, app, "GET", "/api/v1/users", plain, nil), 403, response.CodePermissionDenied)
	expectCode(t, call(t, app, "GET", "/api/v1/options/roles", plain, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "GET", "/api/v1/options/departments", plain, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "PUT", "/api/v1/users/me/preferences", plain, map[string]any{"theme": "dark"}), 200, response.CodeSuccess)
}
