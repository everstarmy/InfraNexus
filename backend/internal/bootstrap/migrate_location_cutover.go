package bootstrap

import "gorm.io/gorm"

const migrationLocationCutover = "20261111_v08_location_cutover"

func migrateLocationCutover(tx *gorm.DB) error {
	if err := tx.Exec(`
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dc_warehouse) OR EXISTS (SELECT 1 FROM dc_temporary_location)
        OR EXISTS (SELECT 1 FROM ipam_security_zone) OR EXISTS (SELECT 1 FROM dc_rack_unit_allocation) THEN
        RAISE EXCEPTION 'location cutover requires empty dependent development tables';
    END IF;
END;
$$;
ALTER TABLE dc_warehouse DROP CONSTRAINT fk_dc_warehouse_datacenter_id;
ALTER TABLE dc_temporary_location DROP CONSTRAINT fk_dc_temporary_location_datacenter_id;
ALTER TABLE ipam_security_zone DROP CONSTRAINT fk_ipam_security_zone_datacenter_id;
ALTER TABLE dc_rack_unit_allocation DROP CONSTRAINT fk_dc_rack_unit_allocation_rack_id;
DROP TABLE dc_rack, dc_rack_row, dc_room, dc_floor, dc_building, dc_datacenter;

CREATE TABLE dc_rack_security_zone (
    rack_id uuid PRIMARY KEY REFERENCES dc_location(uid),
    security_zone_id uuid NOT NULL REFERENCES ipam_security_zone(id)
);

CREATE FUNCTION dc_location_check_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    node_id uuid := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
BEGIN
    PERFORM 1 FROM dc_location WHERE uid = node_id AND type = TG_ARGV[1]
        AND status = 1 AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
        RAISE foreign_key_violation USING MESSAGE = 'location reference is unavailable';
    END IF;
    IF TG_TABLE_NAME = 'dc_rack_unit_allocation' AND NOT EXISTS (
        SELECT 1 FROM dc_location WHERE uid = node_id AND (ext->>'height_u')::integer >= (to_jsonb(NEW)->>'unit')::integer
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'rack allocation exceeds height';
    END IF;
    RETURN NEW;
END;
$$;
ALTER TABLE dc_warehouse ADD FOREIGN KEY (datacenter_id) REFERENCES dc_location(uid);
ALTER TABLE dc_temporary_location ADD FOREIGN KEY (datacenter_id) REFERENCES dc_location(uid);
ALTER TABLE ipam_security_zone ADD FOREIGN KEY (datacenter_id) REFERENCES dc_location(uid);
ALTER TABLE dc_rack_unit_allocation ADD FOREIGN KEY (rack_id) REFERENCES dc_location(uid);
CREATE TRIGGER location_reference BEFORE INSERT OR UPDATE OF datacenter_id ON dc_warehouse
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_reference('datacenter_id', 'datacenter');
CREATE TRIGGER location_reference BEFORE INSERT OR UPDATE OF datacenter_id ON dc_temporary_location
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_reference('datacenter_id', 'datacenter');
CREATE TRIGGER location_reference BEFORE INSERT OR UPDATE OF datacenter_id ON ipam_security_zone
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_reference('datacenter_id', 'datacenter');
CREATE TRIGGER location_reference BEFORE INSERT OR UPDATE OF rack_id ON dc_rack_unit_allocation
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_reference('rack_id', 'rack');
CREATE TRIGGER location_rack_allocation_guard BEFORE UPDATE OF unit, deleted_at ON dc_rack_unit_allocation
    FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION dc_location_check_reference('rack_id', 'rack');
CREATE FUNCTION dc_location_check_rack_zone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM dc_location rack
        JOIN dc_location room ON room.uid = rack.parent
        JOIN dc_location building ON building.uid = room.parent
        JOIN ipam_security_zone zone ON zone.datacenter_id = building.parent
        WHERE rack.uid = NEW.rack_id AND rack.type = 'rack' AND rack.status = 1
            AND rack.deleted_at IS NULL AND zone.id = NEW.security_zone_id
            AND zone.status = 1 AND zone.deleted_at IS NULL
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'rack and security zone must belong to the same active datacenter';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER location_reference BEFORE INSERT OR UPDATE ON dc_rack_security_zone
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_rack_zone();

CREATE FUNCTION dc_location_lock_topology() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(2026111107);
    RETURN NULL;
END;
$$;
CREATE TRIGGER location_topology_lock BEFORE INSERT OR UPDATE OR DELETE ON dc_location
    FOR EACH STATEMENT EXECUTE FUNCTION dc_location_lock_topology();
CREATE TRIGGER location_topology_lock BEFORE INSERT OR UPDATE OR DELETE ON dc_rack_unit_allocation
    FOR EACH STATEMENT EXECUTE FUNCTION dc_location_lock_topology();
CREATE TRIGGER location_topology_lock BEFORE INSERT OR UPDATE OR DELETE ON dc_rack_security_zone
    FOR EACH STATEMENT EXECUTE FUNCTION dc_location_lock_topology();
CREATE TRIGGER location_topology_lock BEFORE INSERT OR UPDATE OR DELETE ON dc_warehouse
    FOR EACH STATEMENT EXECUTE FUNCTION dc_location_lock_topology();
CREATE TRIGGER location_topology_lock BEFORE INSERT OR UPDATE OR DELETE ON dc_temporary_location
    FOR EACH STATEMENT EXECUTE FUNCTION dc_location_lock_topology();
CREATE TRIGGER location_topology_lock BEFORE INSERT OR UPDATE OR DELETE ON ipam_security_zone
    FOR EACH STATEMENT EXECUTE FUNCTION dc_location_lock_topology();

CREATE FUNCTION dc_location_check_zone_dependents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.status <> 1 OR NEW.deleted_at IS NOT NULL OR NEW.datacenter_id IS DISTINCT FROM OLD.datacenter_id)
        AND EXISTS (SELECT 1 FROM dc_rack_security_zone WHERE security_zone_id = OLD.id) THEN
        RAISE foreign_key_violation USING MESSAGE = 'security zone still has rack references';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER location_zone_dependents BEFORE UPDATE ON ipam_security_zone
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_zone_dependents();

CREATE FUNCTION dc_location_check_dependents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.deleted_at IS NOT NULL OR NEW.status = 2) AND (
        EXISTS (SELECT 1 FROM dc_warehouse WHERE datacenter_id = NEW.uid AND deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM dc_temporary_location WHERE datacenter_id = NEW.uid AND deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM ipam_security_zone WHERE datacenter_id = NEW.uid AND deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM dc_rack_unit_allocation WHERE rack_id = NEW.uid AND deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM dc_rack_security_zone WHERE rack_id = NEW.uid)
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'location still has business references';
    END IF;
    IF NEW.type = 'rack' AND EXISTS (SELECT 1 FROM dc_rack_unit_allocation
        WHERE rack_id = NEW.uid AND deleted_at IS NULL AND unit > (NEW.ext->>'height_u')::integer) THEN
        RAISE foreign_key_violation USING MESSAGE = 'rack height conflicts with an allocation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER dc_location_check_dependents BEFORE UPDATE ON dc_location
    FOR EACH ROW EXECUTE FUNCTION dc_location_check_dependents();
`).Error; err != nil {
		return err
	}
	return tx.Exec(`
CREATE TEMP TABLE retired_location_permissions ON COMMIT DROP AS
SELECT id FROM permissions WHERE
    code ~ '^locations:(datacenters|buildings|floors|rooms|rack-rows|racks)(:|$)'
    OR path ~ '^/api/v1/locations/(datacenters|buildings|floors|rooms|rack-rows|racks)(/|$)';
UPDATE permissions SET parent_id = NULL WHERE parent_id IN (SELECT id FROM retired_location_permissions)
    AND id NOT IN (SELECT id FROM retired_location_permissions);
DELETE FROM sys_role_permissions WHERE permission_id IN (SELECT id FROM retired_location_permissions);
DELETE FROM permissions WHERE id IN (SELECT id FROM retired_location_permissions);
`).Error
}
