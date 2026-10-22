package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
)

func TestLDAPDepartmentCreationInterleavesWithUserTransfer(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "ldap-organization.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	runLDAPDepartmentCreationInterleavesWithUserTransfer(t, db)
}

func TestLDAPDepartmentCreationInterleavesWithUserTransferPostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("connect test PostgreSQL database: %v", err)
	}
	runLDAPDepartmentCreationInterleavesWithUserTransfer(t, db)
}

func runLDAPDepartmentCreationInterleavesWithUserTransfer(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.Permission{}, &domain.User{}, &domain.OrganizationState{}); err != nil {
		t.Fatal(err)
	}
	state := domain.OrganizationState{ID: domain.OrganizationStateID, Revision: 1}
	if err := db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.Assignments(map[string]any{"revision": 1})}).Create(&state).Error; err != nil {
		t.Fatal(err)
	}
	departments := repository.NewDepartmentRepository(db)
	users := repository.NewUserRepository(db)
	organization := repository.NewOrganizationUnitOfWork(db)
	source := domain.Department{BaseEntity: domain.BaseEntity{ID: uuid.New()}, Name: "Source", Code: "source-" + uuid.NewString()[:8], Status: domain.StatusEnabled, Source: domain.SourceLocal}
	source.TreePath = domain.DepartmentPath(domain.DepartmentRootPath, source.ID)
	target := domain.Department{BaseEntity: domain.BaseEntity{ID: uuid.New()}, Name: "Target", Code: "target-" + uuid.NewString()[:8], Status: domain.StatusEnabled, Source: domain.SourceLocal}
	target.TreePath = domain.DepartmentPath(domain.DepartmentRootPath, target.ID)
	if err := departments.Create(t.Context(), &source); err != nil {
		t.Fatal(err)
	}
	if err := departments.Create(t.Context(), &target); err != nil {
		t.Fatal(err)
	}
	member := domain.User{Username: "member-" + uuid.NewString()[:8], Email: uuid.NewString() + "@example.test", Password: "hash", DepartmentID: &source.ID, Status: domain.StatusEnabled}
	if err := users.Create(t.Context(), &member); err != nil {
		t.Fatal(err)
	}

	locked := make(chan struct{})
	release := make(chan struct{})
	transferDone := make(chan error, 1)
	go func() {
		_, err := organization.Write(t.Context(), nil, func(ctx context.Context) error {
			moved, err := users.MoveToDepartment(ctx, []uuid.UUID{member.ID}, target.ID)
			if err != nil {
				return err
			}
			if moved != 1 {
				return fmt.Errorf("moved %d users, want 1", moved)
			}
			close(locked)
			<-release
			return nil
		})
		transferDone <- err
	}()
	<-locked

	ldapDomain := "corp-" + uuid.NewString()[:8] + ".local"
	ldapUsername := "ldap-user-" + uuid.NewString()[:8]
	cfg := &domain.LDAPConfig{Domain: ldapDomain, Type: domain.AuthTypeAD}
	plan := plannedUser{
		item:   domain.SyncPlanItem{Action: domain.SyncActionCreate, Username: ldapUsername},
		dir:    domain.DirectoryUser{Username: ldapUsername, ExternalID: "ldap-user-guid-" + uuid.NewString()[:8], Nickname: "LDAP User"},
		target: &deptTarget{BaseID: &target.ID, Segments: []deptSegment{{Name: "Sales", ExternalID: "ou=sales,dc=corp,dc=local-" + uuid.NewString()[:8]}}},
		values: map[string]any{"email": uuid.NewString() + "@example.test"},
	}
	ldap := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Users: users, Departments: departments, Organization: organization}}
	ldapStarted := make(chan struct{})
	ldapDone := make(chan error, 1)
	go func() {
		close(ldapStarted)
		_, err := ldap.apply(t.Context(), cfg, newDepartmentResolver(departments), plan)
		ldapDone <- err
	}()
	<-ldapStarted
	time.Sleep(60 * time.Millisecond)
	close(release)
	if err := <-transferDone; err != nil {
		t.Fatal(err)
	}
	if err := <-ldapDone; err != nil {
		t.Fatalf("LDAP apply after concurrent transfer: %v", err)
	}

	var moved domain.User
	if err := db.First(&moved, "id = ?", member.ID).Error; err != nil {
		t.Fatal(err)
	}
	if moved.DepartmentID == nil || *moved.DepartmentID != target.ID {
		t.Fatalf("concurrent transfer lost: department_id=%v", moved.DepartmentID)
	}
	var imported domain.User
	if err := db.Preload("Department").First(&imported, "username = ? AND domain = ?", ldapUsername, ldapDomain).Error; err != nil {
		t.Fatal(err)
	}
	if imported.Department == nil || imported.Department.Name != "Sales" || imported.Department.ParentID == nil || *imported.Department.ParentID != target.ID {
		t.Fatalf("LDAP department/user write did not commit as one subtree: %+v", imported.Department)
	}
	revision, err := organization.Revision(t.Context())
	if err != nil || revision != 3 {
		t.Fatalf("organization revision = %d, %v; want two committed writes", revision, err)
	}
}
