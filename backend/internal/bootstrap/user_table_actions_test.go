package bootstrap

import (
	"bytes"
	"encoding/csv"
	"encoding/json/v2"
	"github.com/google/uuid"
	"io"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func TestUserTableBatchScopeReplayAndConflict(t *testing.T) {
	c, app, cleanup := setupTestApp(t)
	defer cleanup()
	token := adminToken(t, app)
	first := createLocalUser(t, app, token, "bulk-first", nil)
	second := createLocalUser(t, app, token, "bulk-second", nil)
	selection := domain.UserSelection{Mode: "allMatching", Query: domain.UserSelectionQuery{Keyword: "bulk-"}}
	req := domain.UserBatchRequest{Selection: selection, Status: 2}
	r := call(t, app, "POST", "/api/v1/users/batch-status/preview", token, req)
	expectCode(t, r, 200, response.CodeSuccess)
	preview := decode[domain.UserBatchPreview](t, r.Data)
	if preview.Eligible != 2 {
		t.Fatalf("preview: %+v", preview)
	}
	for _, item := range preview.Items {
		req.Items = append(req.Items, domain.UserBatchVersion{ID: item.ID, Revision: item.Revision})
	}
	third := createLocalUser(t, app, token, "bulk-third", nil)
	if err := c.DB.Model(&domain.User{}).Where("id = ?", second.ID).Update("edit_revision", second.EditRevision+1).Error; err != nil {
		t.Fatal(err)
	}
	r = call(t, app, "POST", "/api/v1/users/batch-status", token, req)
	expectCode(t, r, 200, response.CodeSuccess)
	result := decode[domain.UserBatchResult](t, r.Data)
	if result.Success != 1 || result.Failed != 1 || result.NewMatches != 1 {
		t.Fatalf("result: %+v", result)
	}
	r = call(t, app, "POST", "/api/v1/users/batch-status", token, req)
	expectCode(t, r, 200, response.CodeSuccess)
	result = decode[domain.UserBatchResult](t, r.Data)
	if result.Success != 0 || result.Skipped != 1 || result.Failed != 1 {
		t.Fatalf("replay: %+v", result)
	}
	var actual domain.User
	if err := c.DB.First(&actual, "id = ?", first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if actual.EditRevision != first.EditRevision+1 || actual.Status != 2 {
		t.Fatalf("replay mutated: %+v", actual)
	}
	actual = domain.User{}
	if err := c.DB.First(&actual, "id = ?", third.ID).Error; err != nil {
		t.Fatal(err)
	}
	if actual.Status != 1 {
		t.Fatal("new match was mutated")
	}
}

func TestUserTableExportAuthorizationFieldsAndEscaping(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	token := adminToken(t, app)
	user := createLocalUser(t, app, token, "export-user", map[string]any{"nickname": "=SUM(1,2)"})
	request := domain.UserExportRequest{Selection: domain.UserSelection{Mode: "ids", IDs: []uuid.UUID{user.ID}}, Fields: []string{"username", "nickname"}}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	httpReq := httptest.NewRequest("POST", "/api/v1/users/export", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", token)
	res, err := app.Test(httpReq)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	content, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 || !bytes.HasPrefix(content, []byte{0xef, 0xbb, 0xbf}) || !strings.Contains(string(content), "\"'=SUM(1,2)\"") {
		t.Fatalf("export status %d: %s", res.StatusCode, content)
	}
	request.Fields = []string{"password"}
	expectCode(t, call(t, app, "POST", "/api/v1/users/export", token, request), 400, response.CodeParamInvalid)
	request.Fields = []string{"username"}
	expectCode(t, call(t, app, "POST", "/api/v1/users/export", "", request), 401, response.CodeTokenExpired)
}

func TestUserTableExportDepartmentAndRoles(t *testing.T) {
	c, app, cleanup := setupTestApp(t)
	defer cleanup()
	token := adminToken(t, app)
	user := createLocalUser(t, app, token, "export-relations", nil)
	department := domain.Department{Name: "=技术部,\"平台\"\n研发", Code: "export-department", TreePath: domain.DepartmentRootPath}
	if err := c.DB.Create(&department).Error; err != nil {
		t.Fatal(err)
	}
	roles := []domain.Role{{Name: "运维人员", Code: "export-ops"}, {Name: "=管理员", Code: "export-admin"}}
	if err := c.DB.Create(&roles).Error; err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"page", "ids", "allMatching"} {
		for _, assigned := range []bool{false, true} {
			t.Run(mode+map[bool]string{false: "/unassigned", true: "/assigned"}[assigned], func(t *testing.T) {
				var departmentID any
				var assignedRoles []domain.Role
				if assigned {
					departmentID = department.ID
					assignedRoles = roles
				}
				if err := c.DB.Model(&user).Update("department_id", departmentID).Error; err != nil {
					t.Fatal(err)
				}
				if err := c.DB.Model(&user).Association("Roles").Replace(assignedRoles); err != nil {
					t.Fatal(err)
				}
				selection := domain.UserSelection{Mode: mode, Query: domain.UserSelectionQuery{Keyword: user.Username}}
				if mode != "allMatching" {
					selection.IDs = []uuid.UUID{user.ID}
				}
				body, err := json.Marshal(domain.UserExportRequest{Selection: selection, Fields: []string{"roles", "username", "department"}})
				if err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest("POST", "/api/v1/users/export", bytes.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Authorization", token)
				res, err := app.Test(req)
				if err != nil {
					t.Fatal(err)
				}
				defer res.Body.Close()
				content, err := io.ReadAll(res.Body)
				if err != nil {
					t.Fatal(err)
				}
				if res.StatusCode != 200 {
					t.Fatalf("export status %d: %s", res.StatusCode, content)
				}
				records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(content), "\ufeff"))).ReadAll()
				if err != nil {
					t.Fatal(err)
				}
				want := []string{"", user.Username, ""}
				if assigned {
					want = []string{"'=管理员、运维人员", user.Username, "'" + department.Name}
				}
				if len(records) != 2 || !slices.Equal(records[0], []string{"角色", "用户名", "部门"}) || !slices.Equal(records[1], want) {
					t.Fatalf("CSV records = %q, want header and %q", records, want)
				}
			})
		}
	}
}

func TestUserTableSelectionGuards(t *testing.T) {
	c, app, cleanup := setupTestApp(t)
	defer cleanup()
	token := adminToken(t, app)
	user := createLocalUser(t, app, token, "table-reader", nil)
	reader := tokenFor(t, app, "table-reader", "Str0ng!pass")
	req := domain.UserBatchRequest{Selection: domain.UserSelection{Mode: "ids", IDs: []uuid.UUID{user.ID}}, Status: 2}
	expectCode(t, call(t, app, "POST", "/api/v1/users/batch-status/preview", reader, req), 403, response.CodePermissionDenied)
	expectCode(t, call(t, app, "POST", "/api/v1/users/export", reader, domain.UserExportRequest{Selection: req.Selection, Fields: []string{"username"}}), 403, response.CodePermissionDenied)
	var admin domain.User
	if err := c.DB.First(&admin, "username = ?", "admin").Error; err != nil {
		t.Fatal(err)
	}
	req.Selection.IDs = []uuid.UUID{admin.ID}
	r := call(t, app, "POST", "/api/v1/users/batch-status/preview", token, req)
	expectCode(t, r, 200, response.CodeSuccess)
	p := decode[domain.UserBatchPreview](t, r.Data)
	if p.Eligible != 0 || p.Skipped != 1 || p.Items[0].Reason == "" {
		t.Fatalf("protected actor: %+v", p)
	}
	req.Selection = domain.UserSelection{Mode: "allMatching", ExcludedIDs: []uuid.UUID{user.ID}, Query: domain.UserSelectionQuery{Keyword: "table-reader"}}
	r = call(t, app, "POST", "/api/v1/users/batch-status/preview", token, req)
	expectCode(t, r, 200, response.CodeSuccess)
	if p = decode[domain.UserBatchPreview](t, r.Data); p.Matched != 0 {
		t.Fatalf("excluded ID matched: %+v", p)
	}
	req.Selection = domain.UserSelection{Mode: "ids", IDs: make([]uuid.UUID, 501)}
	for i := range req.Selection.IDs {
		req.Selection.IDs[i] = uuid.New()
	}
	expectCode(t, call(t, app, "POST", "/api/v1/users/batch-status/preview", token, req), 400, response.CodeParamInvalid)
}

func TestUserTableDeletedSelectionAndExecutionLimit(t *testing.T) {
	c, app, cleanup := setupTestApp(t)
	defer cleanup()
	token := adminToken(t, app)
	user := createLocalUser(t, app, token, "deleted-selection", nil)
	if err := c.DB.Delete(&user).Error; err != nil {
		t.Fatal(err)
	}
	req := domain.UserBatchRequest{Selection: domain.UserSelection{Mode: "ids", IDs: []uuid.UUID{user.ID}}, Status: 2, Items: []domain.UserBatchVersion{{ID: user.ID, Revision: user.EditRevision}}}
	r := call(t, app, "POST", "/api/v1/users/batch-status", token, req)
	expectCode(t, r, 200, response.CodeSuccess)
	result := decode[domain.UserBatchResult](t, r.Data)
	if result.Success != 0 || result.Skipped != 1 {
		t.Fatalf("deleted row: %+v", result)
	}
	users := make([]domain.User, 201)
	for i := range users {
		users[i] = domain.User{Username: "limit-" + uuid.NewString(), Status: 1, AuthType: "local"}
	}
	if err := c.DB.CreateInBatches(&users, 50).Error; err != nil {
		t.Fatal(err)
	}
	req = domain.UserBatchRequest{Selection: domain.UserSelection{Mode: "allMatching", Query: domain.UserSelectionQuery{Keyword: "limit-"}}, Status: 2}
	expectCode(t, call(t, app, "POST", "/api/v1/users/batch-status/preview", token, req), 400, response.CodeParamInvalid)
}
