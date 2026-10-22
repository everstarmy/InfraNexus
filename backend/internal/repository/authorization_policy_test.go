package repository

import (
	"context"
	"os"
	"testing"

	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

func TestRolePolicyOutboxFailureRollsBackPermissionAndRevision(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/authorization-atomicity.db"), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Role{}, &domain.Permission{}, &domain.AuthorizationState{}, &domain.AuthorizationOutbox{}, &gormadapter.CasbinRule{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.AuthorizationState{ID: domain.AuthorizationStateID, Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	role := domain.Role{Code: "atomic-operator", Name: "Atomic operator", Status: domain.StatusEnabled}
	permission := domain.Permission{Code: "api:GET:/api/v1/atomic", Name: "Atomic API", Type: domain.PermTypeAPI, Path: "/api/v1/atomic", Method: "GET"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&permission).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TRIGGER reject_authorization_outbox BEFORE INSERT ON authorization_outbox BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END`).Error; err != nil {
		t.Fatal(err)
	}

	err = NewRoleRepository(db).AssignPermissions(context.Background(), role.ID, []uuid.UUID{permission.ID}, 1)
	if err == nil {
		t.Fatal("AssignPermissions() succeeded despite outbox insert failure")
	}
	var roleReloaded domain.Role
	if err := db.First(&roleReloaded, "id = ?", role.ID).Error; err != nil {
		t.Fatal(err)
	}
	if roleReloaded.EditRevision != 1 {
		t.Fatalf("role revision = %d, want rollback to 1", roleReloaded.EditRevision)
	}
	for _, table := range []string{"sys_role_permissions", "casbin_rule", "authorization_outbox"} {
		var count int64
		switch table {
		case "sys_role_permissions":
			if err := db.Table(table).Where("role_id = ? AND permission_id = ?", role.ID, permission.ID).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
		case "casbin_rule":
			if err := db.Model(&gormadapter.CasbinRule{}).Where("ptype = ? AND v0 = ?", "p", role.Code).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
		case "authorization_outbox":
			if err := db.Model(&domain.AuthorizationOutbox{}).Where("revision = ?", 2).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
		}
		if count != 0 {
			t.Fatalf("%s has %d partially committed rows", table, count)
		}
	}
	var state domain.AuthorizationState
	if err := db.First(&state, "id = ?", domain.AuthorizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != 1 {
		t.Fatalf("authorization revision = %d, want rollback to 1", state.Revision)
	}
}

func TestRolePolicyTransactionsPostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("connect test PostgreSQL database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Role{}, &domain.Permission{}, &domain.AuthorizationState{}, &domain.AuthorizationOutbox{}, &gormadapter.CasbinRule{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Unscoped().Where("id = ?", domain.AuthorizationStateID).Delete(&domain.AuthorizationState{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Unscoped().Where("1 = 1").Delete(&domain.AuthorizationOutbox{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.AuthorizationState{ID: domain.AuthorizationStateID, Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	role := domain.Role{Code: "pg-operator-" + uuid.NewString()[:8], Name: "PostgreSQL operator", Status: domain.StatusEnabled}
	permission := domain.Permission{
		Code: "api:GET:/api/v1/pg-" + uuid.NewString()[:8], Name: "PostgreSQL API",
		Type: domain.PermTypeAPI, Path: "/api/v1/pg-resource", Method: "GET",
	}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&permission).Error; err != nil {
		t.Fatal(err)
	}
	roles := NewRoleRepository(db)
	if err := roles.AssignPermissions(t.Context(), role.ID, []uuid.UUID{permission.ID}, 1); err != nil {
		t.Fatalf("AssignPermissions() on PostgreSQL: %v", err)
	}
	var policies []gormadapter.CasbinRule
	if err := db.Where("ptype = ? AND v0 = ?", "p", role.Code).Find(&policies).Error; err != nil {
		t.Fatal(err)
	}
	if len(policies) != 1 || policies[0].V1 != permission.Path || policies[0].V2 != permission.Method {
		t.Fatalf("PostgreSQL policy after grant = %+v", policies)
	}
	if err := roles.UpdateStatus(t.Context(), role.ID, domain.StatusDisabled, 2); err != nil {
		t.Fatalf("UpdateStatus() on PostgreSQL: %v", err)
	}
	if err := db.Where("ptype = ? AND v0 = ?", "p", role.Code).Find(&policies).Error; err != nil {
		t.Fatal(err)
	}
	if len(policies) != 0 {
		t.Fatalf("disabled PostgreSQL role retained Casbin policies: %+v", policies)
	}
	var state domain.AuthorizationState
	if err := db.First(&state, "id = ?", domain.AuthorizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != 3 {
		t.Fatalf("PostgreSQL authorization revision = %d, want 3", state.Revision)
	}
	var outboxCount int64
	if err := db.Model(&domain.AuthorizationOutbox{}).Where("revision IN ?", []int64{2, 3}).Count(&outboxCount).Error; err != nil {
		t.Fatal(err)
	}
	if outboxCount != 2 {
		t.Fatalf("PostgreSQL policy outbox rows = %d, want 2", outboxCount)
	}
}
