package bootstrap

import (
	"context"
	"database/sql"
	"testing"

	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

// auditLiveADSnapshot performs SELECTs only. PostgreSQL also enforces a
// read-only transaction. This audits the disposable fixture, never deployment data.
func auditLiveADSnapshot(t *testing.T, ctx context.Context, app *AppContainer, cfg domain.LDAPConfig, taskID uuid.UUID) {
	t.Helper()
	missingPolicies, extraPolicies, missingRoles, brokenDepartments, inconsistentTasks := 0, 0, 0, 0, 0
	err := app.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var roles []domain.Role
		if err := tx.Preload("Permissions").Find(&roles).Error; err != nil {
			return err
		}
		wanted := make(map[[3]string]int)
		for _, role := range roles {
			if role.Status != domain.StatusEnabled {
				continue
			}
			for _, permission := range role.Permissions {
				if permission.Type == domain.PermTypeAPI && permission.Path != "" && permission.Method != "" {
					wanted[[3]string{role.Code, permission.Path, permission.Method}] = 1
				}
			}
		}
		var rules []gormadapter.CasbinRule
		if err := tx.Where("ptype = ?", "p").Find(&rules).Error; err != nil {
			return err
		}
		current := make(map[[3]string]int)
		for _, rule := range rules {
			if rule.V3 != "" || rule.V4 != "" || rule.V5 != "" {
				extraPolicies++
				continue
			}
			current[[3]string{rule.V0, rule.V1, rule.V2}]++
		}
		for key, count := range wanted {
			missingPolicies += max(0, count-current[key])
		}
		for key, count := range current {
			extraPolicies += max(0, count-wanted[key])
		}
		var users []domain.User
		if err := tx.Preload("Roles").Find(&users).Error; err != nil {
			return err
		}
		var departments []domain.Department
		if err := tx.Find(&departments).Error; err != nil {
			return err
		}
		departmentIDs := make(map[uuid.UUID]bool, len(departments))
		for _, department := range departments {
			departmentIDs[department.ID] = true
		}
		for _, department := range departments {
			if department.ParentID != nil && !departmentIDs[*department.ParentID] {
				brokenDepartments++
			}
		}
		for _, user := range users {
			if user.DepartmentID != nil && !departmentIDs[*user.DepartmentID] {
				brokenDepartments++
			}
			if user.Domain == cfg.Domain && user.AuthType == domain.AuthTypeAD && user.Status == domain.StatusEnabled {
				hasDefault := cfg.DefaultRoleID == nil
				for _, role := range user.Roles {
					if cfg.DefaultRoleID != nil && role.ID == *cfg.DefaultRoleID && role.Status == domain.StatusEnabled {
						hasDefault = true
					}
				}
				if !hasDefault {
					missingRoles++
				}
			}
		}
		var task domain.LDAPSyncLog
		if err := tx.First(&task, "id = ?", taskID).Error; err != nil {
			return err
		}
		report := task.Report.Data()
		classified := report.Created + report.Updated + report.Unchanged + report.Disabled + report.Skipped + report.Failed
		if task.Status != domain.SyncStatusSuccess || task.Total == nil || task.Processed != *task.Total || report.Total != classified || report.Total != *task.Total {
			inconsistentTasks++
		}
		return nil
	}, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal("live application read-only snapshot audit failed")
	}
	if missingPolicies+extraPolicies+missingRoles+brokenDepartments+inconsistentTasks != 0 {
		t.Fatalf("read-only audit anomalies: missing_policies=%d extra_policies=%d missing_default_roles=%d broken_departments=%d task_counts=%d", missingPolicies, extraPolicies, missingRoles, brokenDepartments, inconsistentTasks)
	}
	t.Logf("live AD read-only DB audit passed: db=%s missing_policies=0 extra_policies=0 missing_default_roles=0 broken_departments=0 inconsistent_task_counts=0", app.DB.Dialector.Name())
}
