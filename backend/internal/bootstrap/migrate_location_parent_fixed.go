package bootstrap

import "gorm.io/gorm"

const migrationLocationParentFixed = "20261111_v11_fix_location_parent"

func migrateLocationParentFixed(tx *gorm.DB) error {
	return tx.Exec(`
CREATE FUNCTION dc_location_check_fixed_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.parent IS DISTINCT FROM OLD.parent THEN
        RAISE check_violation USING MESSAGE = 'location parent is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER dc_location_fixed_parent BEFORE UPDATE OF parent ON dc_location
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_fixed_parent();

CREATE TEMP TABLE retired_location_move_permissions ON COMMIT DROP AS
SELECT id FROM permissions WHERE code = 'locations:nodes:move'
    OR path = '/api/v1/locations/nodes/:id/move';
UPDATE permissions SET parent_id = NULL
    WHERE parent_id IN (SELECT id FROM retired_location_move_permissions)
    AND id NOT IN (SELECT id FROM retired_location_move_permissions);
DELETE FROM sys_role_permissions WHERE permission_id IN (SELECT id FROM retired_location_move_permissions);
DELETE FROM permissions WHERE id IN (SELECT id FROM retired_location_move_permissions);
`).Error
}
