package bootstrap

import (
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

const migrationRetiredIPAMBinding = "20261111_v06_retire_ipam_rack_subnet_binding"

func migrateRetiredIPAMBinding(tx *gorm.DB) error {
	if err := tx.Exec(`
		DO $$
		BEGIN
			IF to_regclass('ipam_rack_subnet_binding') IS NOT NULL THEN
				LOCK TABLE ipam_rack_subnet_binding IN ACCESS EXCLUSIVE MODE;
				IF EXISTS (SELECT 1 FROM ipam_rack_subnet_binding) THEN
					CREATE TABLE retired_ipam_rack_subnet_binding AS TABLE ipam_rack_subnet_binding;
				END IF;
				DROP TABLE ipam_rack_subnet_binding;
			END IF;
		END;
		$$
	`).Error; err != nil {
		return fmt.Errorf("retire the former IPAM relation: %w", err)
	}

	var ids []uuid.UUID
	if err := tx.Unscoped().Model(&domain.Permission{}).
		Where("code = ? OR code LIKE ? OR path = ? OR path LIKE ?",
			"ipam:rack-bindings", "ipam:rack-bindings:%", "/api/v1/ipam/rack-bindings", "/api/v1/ipam/rack-bindings/%").
		Pluck("id", &ids).Error; err != nil {
		return fmt.Errorf("find retired IPAM permissions: %w", err)
	}
	if len(ids) == 0 {
		return nil
	}

	// Keep unrelated custom permissions that were placed under a retired node.
	if err := tx.Unscoped().Model(&domain.Permission{}).Where("parent_id IN ? AND id NOT IN ?", ids, ids).
		UpdateColumn("parent_id", nil).Error; err != nil {
		return fmt.Errorf("detach custom permission children: %w", err)
	}
	if err := tx.Exec("DELETE FROM sys_role_permissions WHERE permission_id IN ?", ids).Error; err != nil {
		return fmt.Errorf("remove retired IPAM role grants: %w", err)
	}
	if err := tx.Unscoped().Where("id IN ?", ids).Delete(&domain.Permission{}).Error; err != nil {
		return fmt.Errorf("remove retired IPAM permissions: %w", err)
	}
	return nil
}
