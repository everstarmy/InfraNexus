package bootstrap

import (
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func createDept(t *testing.T, app *fiber.App, bearer, name, code string, parent *uuid.UUID) domain.Department {
	t.Helper()
	body := map[string]any{"name": name, "code": code}
	if parent != nil {
		body["parent_id"] = parent.String()
	}
	r := call(t, app, "POST", "/api/v1/departments", bearer, body)
	expectCode(t, r, 200, response.CodeSuccess)
	return decode[domain.Department](t, r.Data)
}

func findDept(nodes []*domain.DepartmentTreeDTO, id uuid.UUID) *domain.DepartmentTreeDTO {
	for _, n := range nodes {
		if n.ID == id {
			return n
		}
		if found := findDept(n.Children, id); found != nil {
			return found
		}
	}
	return nil
}

func deptTree(t *testing.T, app *fiber.App, bearer string) []*domain.DepartmentTreeDTO {
	t.Helper()
	r := call(t, app, "GET", "/api/v1/departments/tree", bearer, nil)
	expectCode(t, r, 200, response.CodeSuccess)
	return decode[[]*domain.DepartmentTreeDTO](t, r.Data)
}

func TestDepartmentTreeCRUDAndMemberCounts(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	hq := createDept(t, app, bearer, "总部", "hq", nil)
	rd := createDept(t, app, bearer, "研发中心", "rd", &hq.ID)
	platform := createDept(t, app, bearer, "平台组", "platform", &rd.ID)
	if platform.TreePath != "0/"+hq.ID.String()+"/"+rd.ID.String()+"/"+platform.ID.String() {
		t.Fatalf("unexpected tree path %s", platform.TreePath)
	}
	expectCode(t, call(t, app, "POST", "/api/v1/departments", bearer, map[string]any{"name": "研发中心", "code": "rd2", "parent_id": hq.ID}), 409, response.CodeResourceConflict)
	expectCode(t, call(t, app, "POST", "/api/v1/departments", bearer, map[string]any{"name": "另一个", "code": "rd"}), 409, response.CodeResourceConflict)
	expectCode(t, call(t, app, "POST", "/api/v1/departments", bearer, map[string]any{"name": "非法", "code": "1 bad"}), 400, response.CodeParamInvalid)
	r := call(t, app, "POST", "/api/v1/users", bearer, map[string]any{"username": "dev1", "email": "dev1@x.com", "password": "Str0ng!pass", "department_id": platform.ID})
	expectCode(t, r, 200, response.CodeSuccess)
	if user := decode[domain.User](t, r.Data); user.Department == nil || user.Department.ID != platform.ID {
		t.Fatalf("created user not placed in department: %+v", user.Department)
	}
	tree := deptTree(t, app, bearer)
	root := findDept(tree, hq.ID)
	leaf := findDept(tree, platform.ID)
	if root == nil || leaf == nil || root.Depth != 1 || leaf.Depth != 3 {
		t.Fatalf("tree shape wrong: %+v %+v", root, leaf)
	}
	if leaf.MemberCount != 1 || root.MemberCount != 0 || root.TotalMemberCount != 1 {
		t.Fatalf("member counts wrong: leaf=%d root=%d/%d", leaf.MemberCount, root.MemberCount, root.TotalMemberCount)
	}
	update := map[string]any{"name": "研发中心(北京)", "code": "rd", "sort_order": 3, "status": 1}
	r = call(t, app, "PUT", "/api/v1/departments/"+rd.ID.String(), bearer, update)
	expectCode(t, r, 200, response.CodeSuccess)
	if decode[domain.Department](t, r.Data).Name != "研发中心(北京)" {
		t.Fatal("rename not applied")
	}
}

func TestDepartmentMovePreventsCyclesAndRewritesSubtree(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	hq := createDept(t, app, bearer, "总部", "hq", nil)
	rd := createDept(t, app, bearer, "研发中心", "rd", &hq.ID)
	platform := createDept(t, app, bearer, "平台组", "platform", &rd.ID)
	ops := createDept(t, app, bearer, "运维中心", "ops", nil)
	expectCode(t, call(t, app, "POST", "/api/v1/departments/"+hq.ID.String()+"/move", bearer, map[string]any{"parent_id": platform.ID}), 409, response.CodeDepartmentInvalidParent)
	expectCode(t, call(t, app, "POST", "/api/v1/departments/"+hq.ID.String()+"/move", bearer, map[string]any{"parent_id": hq.ID}), 409, response.CodeDepartmentInvalidParent)
	expectCode(t, call(t, app, "POST", "/api/v1/departments/"+rd.ID.String()+"/move", bearer, map[string]any{"parent_id": ops.ID}), 200, response.CodeSuccess)
	tree := deptTree(t, app, bearer)
	moved := findDept(tree, platform.ID)
	if moved == nil || !strings.HasPrefix(moved.TreePath, "0/"+ops.ID.String()+"/"+rd.ID.String()+"/") || moved.Depth != 3 {
		t.Fatalf("descendant path not rewritten: %+v", moved)
	}
	if len(findDept(tree, hq.ID).Children) != 0 {
		t.Fatal("old parent still lists moved department")
	}
	expectCode(t, call(t, app, "POST", "/api/v1/departments/"+rd.ID.String()+"/move", bearer, map[string]any{"parent_id": nil}), 200, response.CodeSuccess)
	tree = deptTree(t, app, bearer)
	if got := findDept(tree, platform.ID).TreePath; got != "0/"+rd.ID.String()+"/"+platform.ID.String() {
		t.Fatalf("move to root path: %s", got)
	}
}

func TestDepartmentDepthLimitAndReorder(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	var parent *uuid.UUID
	for i := range domain.MaxDepartmentDepth {
		d := createDept(t, app, bearer, "层级", "lvl-"+string(rune('a'+i)), parent)
		parent = &d.ID
	}
	expectCode(t, call(t, app, "POST", "/api/v1/departments", bearer, map[string]any{"name": "过深", "code": "too-deep", "parent_id": parent}), 409, response.CodeDepartmentInvalidParent)
	a := createDept(t, app, bearer, "甲", "dept-a", nil)
	b := createDept(t, app, bearer, "乙", "dept-b", nil)
	r := call(t, app, "PUT", "/api/v1/departments/reorder", bearer, map[string]any{"items": []map[string]any{{"id": a.ID, "sort_order": 9}, {"id": b.ID, "sort_order": 1}}})
	expectCode(t, r, 200, response.CodeSuccess)
	var order []uuid.UUID
	for _, n := range deptTree(t, app, bearer) {
		if n.ID == a.ID || n.ID == b.ID {
			order = append(order, n.ID)
		}
	}
	if len(order) != 2 || order[0] != b.ID {
		t.Fatalf("reorder not reflected: %v", order)
	}
}

func TestDepartmentDeleteIsBlockedByChildrenAndMembers(t *testing.T) {
	_, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	rd := createDept(t, app, bearer, "研发中心", "rd", nil)
	platform := createDept(t, app, bearer, "平台组", "platform", &rd.ID)
	parking := createDept(t, app, bearer, "待分配", "parking", nil)
	r := call(t, app, "POST", "/api/v1/users", bearer, map[string]any{"username": "dev1", "email": "dev1@x.com", "password": "Str0ng!pass", "department_id": platform.ID})
	user := decode[domain.User](t, r.Data)
	expectCode(t, call(t, app, "DELETE", "/api/v1/departments/"+rd.ID.String(), bearer, nil), 409, response.CodeDepartmentHasChildren)
	expectCode(t, call(t, app, "DELETE", "/api/v1/departments/"+platform.ID.String(), bearer, nil), 409, response.CodeDepartmentHasMembers)
	expectCode(t, call(t, app, "POST", "/api/v1/users/batch-move-department", bearer, map[string]any{"user_ids": []uuid.UUID{user.ID}, "target_dept_id": parking.ID}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "DELETE", "/api/v1/departments/"+platform.ID.String(), bearer, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "DELETE", "/api/v1/departments/"+rd.ID.String(), bearer, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "GET", "/api/v1/departments/"+rd.ID.String(), bearer, nil), 404, response.CodeDepartmentNotFound)
	createDept(t, app, bearer, "研发中心", "rd", nil)
}
