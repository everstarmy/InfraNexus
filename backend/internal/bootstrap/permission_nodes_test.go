package bootstrap

import (
	"github.com/google/uuid"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"testing"
)

func TestPermissionNodesRootPagingAndFilteredAncestors(t *testing.T) {
	c, app, cleanup := setupTestApp(t)
	defer cleanup()
	token := adminToken(t, app)
	makeNode := func(code string, parent *uuid.UUID) uuid.UUID {
		p := domain.Permission{Code: code, Name: code, Type: domain.PermTypeMenu, ParentID: parent}
		if err := c.DB.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	root := makeNode("m4-root", nil)
	mid := makeNode("m4-mid", &root)
	makeNode("m4-match", &mid)
	makeNode("unrelated-child", &root)
	makeNode("m4-another-root", nil)
	r := call(t, app, "GET", "/api/v1/permissions/nodes?keyword=m4-match&page_size=1", token, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	page := decode[domain.PermissionNodePage](t, r.Data)
	if page.RootTotal != 1 || page.Total != 1 || page.MatchedNodes != 1 || page.RetainedNodes != 3 || len(page.Items) != 1 || page.Items[0].ID != root || !page.Items[0].HasChildren || len(page.Items[0].Children) != 0 {
		t.Fatalf("root scope: %+v", page)
	}
	r = call(t, app, "GET", "/api/v1/permissions/nodes?keyword=m4-match&parent_id="+root.String(), token, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	page = decode[domain.PermissionNodePage](t, r.Data)
	if page.Total != 1 || page.Items[0].ID != mid {
		t.Fatalf("filtered children: %+v", page)
	}
	r = call(t, app, "GET", "/api/v1/permissions/nodes?keyword=m4-&page_size=1&page=2", token, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	page = decode[domain.PermissionNodePage](t, r.Data)
	if page.RootTotal != 2 || len(page.Items) != 1 {
		t.Fatalf("root paging: %+v", page)
	}
	expectCode(t, call(t, app, "GET", "/api/v1/permissions/nodes?parent_id=bad", token, nil), 400, response.CodeParamInvalid)
	expectCode(t, call(t, app, "GET", "/api/v1/permissions/nodes?page_size=101", token, nil), 400, response.CodeParamInvalid)
	expectCode(t, call(t, app, "GET", "/api/v1/permissions/nodes?keyword=absent", "", nil), 401, response.CodeTokenExpired)
	createLocalUser(t, app, token, "m4-reader", nil)
	reader := tokenFor(t, app, "m4-reader", "Str0ng!pass")
	expectCode(t, call(t, app, "GET", "/api/v1/permissions/nodes", reader, nil), 403, response.CodePermissionDenied)
}
