package bootstrap

import "gorm.io/gorm"

const migrationLocationTransferRetirement = "20261111_v09_retire_location_transfer"

func migrateLocationTransferRetirement(tx *gorm.DB) error {
	return tx.Exec(`
CREATE TEMP TABLE retired_location_transfer_permissions ON COMMIT DROP AS
SELECT id FROM permissions WHERE
    code IN ('locations:nodes:import', 'locations:nodes:export')
    OR path IN ('/api/v1/locations/nodes/import', '/api/v1/locations/nodes/import/preview', '/api/v1/locations/nodes/export');
UPDATE permissions SET parent_id = NULL
    WHERE parent_id IN (SELECT id FROM retired_location_transfer_permissions)
    AND id NOT IN (SELECT id FROM retired_location_transfer_permissions);
DELETE FROM sys_role_permissions WHERE permission_id IN (SELECT id FROM retired_location_transfer_permissions);
DELETE FROM permissions WHERE id IN (SELECT id FROM retired_location_transfer_permissions);
`).Error
}
