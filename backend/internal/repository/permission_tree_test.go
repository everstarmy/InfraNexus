package repository

import (
	"testing"

	"github.com/google/uuid"

	"infranexus/internal/domain"
)

func TestBuildPermissionTreeKeepsNodesInParentCycle(t *testing.T) {
	root := domain.Permission{Code: "root"}
	root.ID = uuid.New()
	a := domain.Permission{Code: "a"}
	a.ID = uuid.New()
	b := domain.Permission{Code: "b", ParentID: &a.ID}
	b.ID = uuid.New()
	a.ParentID = &b.ID

	tree := BuildPermissionTree([]domain.Permission{root, a, b})
	seen := map[string]int{}
	var walk func(nodes []domain.Permission)
	walk = func(nodes []domain.Permission) {
		for _, n := range nodes {
			seen[n.Code]++
			walk(n.Children)
		}
	}
	walk(tree)
	for _, code := range []string{"root", "a", "b"} {
		if seen[code] != 1 {
			t.Fatalf("node %s appeared %d times in %+v", code, seen[code], seen)
		}
	}
}
