package bootstrap

import (
	"testing"

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
