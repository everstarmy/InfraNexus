package bootstrap

import "gorm.io/gorm"

const migrationManagedTransferRetirement = "20261111_v10_retire_managed_transfer"

func migrateManagedTransferRetirement(tx *gorm.DB) error {
	return tx.Exec(`
CREATE TEMP TABLE retired_managed_transfer_permissions ON COMMIT DROP AS
SELECT id FROM permissions WHERE
    code ~ '^(locations:(warehouses|shelves|bins|temporary-locations)|ipam:(network-scopes|security-zones|subnets)):(import|export)$'
    OR path ~ '^/api/v1/(locations/(warehouses|shelves|bins|temporary-locations)|ipam/(network-scopes|security-zones|subnets))/(import(/preview)?|export)$';
UPDATE permissions SET parent_id = NULL
    WHERE parent_id IN (SELECT id FROM retired_managed_transfer_permissions)
    AND id NOT IN (SELECT id FROM retired_managed_transfer_permissions);
DELETE FROM sys_role_permissions WHERE permission_id IN (SELECT id FROM retired_managed_transfer_permissions);
DELETE FROM permissions WHERE id IN (SELECT id FROM retired_managed_transfer_permissions);
`).Error
}
