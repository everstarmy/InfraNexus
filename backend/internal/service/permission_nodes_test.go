package service

import (
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/testdb"
)

func TestPermissionNodeScopePostgres(t *testing.T) {
	testPermissionNodeScope(t, testdb.Dialector(t))
}
func testPermissionNodeScope(t *testing.T, driver gorm.Dialector) {
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Permission{}); err != nil {
		t.Fatal(err)
	}
	marker := uuid.NewString()
	root := domain.Permission{Name: marker + "root", Code: marker + "root", Type: domain.PermTypeMenu}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	leaf := domain.Permission{Name: marker + "needle", Code: marker + "needle", Type: domain.PermTypeButton, ParentID: &root.ID}
	if err := db.Create(&leaf).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewPermissionService(repository.NewPermissionRepository(db), nil, nil)
	page, err := svc.Nodes(t.Context(), nil, marker+"needle", 1, 1)
	if err != nil || page.RootTotal != 1 || page.MatchedNodes != 1 || page.RetainedNodes != 2 || len(page.Items) != 1 || page.Items[0].ID != root.ID || !page.Items[0].HasChildren {
		t.Fatalf("root scope %+v %v", page, err)
	}
	page, err = svc.Nodes(t.Context(), &root.ID, marker+"needle", 1, 1)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != leaf.ID || page.Items[0].HasChildren {
		t.Fatalf("child scope %+v %v", page, err)
	}
	page, err = svc.Nodes(t.Context(), &leaf.ID, marker+"needle", 1, 1)
	if err != nil || page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("leaf empty %+v %v", page, err)
	}
	page, err = svc.Nodes(t.Context(), nil, marker+"absent", 1, 1)
	if err != nil || page.Total != 0 || page.MatchedNodes != 0 {
		t.Fatalf("empty scope %+v %v", page, err)
	}
}
