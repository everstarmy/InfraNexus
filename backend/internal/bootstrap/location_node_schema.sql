CREATE TABLE dc_location (
    uid uuid PRIMARY KEY,
    name varchar(128) NOT NULL CHECK (name = btrim(name) AND name <> ''),
    type varchar(16) NOT NULL CHECK (type IN ('datacenter', 'building', 'room', 'rack')),
    parent uuid,
    parent_type varchar(16) GENERATED ALWAYS AS (
        CASE type WHEN 'building' THEN 'datacenter' WHEN 'room' THEN 'building' WHEN 'rack' THEN 'room' END
    ) STORED,
    ext jsonb NOT NULL,
    status smallint NOT NULL DEFAULT 1 CHECK (status IN (1, 2)),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (uid, type),
    FOREIGN KEY (parent, parent_type) REFERENCES dc_location (uid, type) MATCH FULL ON DELETE RESTRICT,
    CHECK (parent IS DISTINCT FROM uid),
    CHECK (
        (jsonb_typeof(ext) = 'object' AND CASE type
            WHEN 'datacenter' THEN
                jsonb_typeof(ext->'address') = 'string'
                AND length(btrim(ext->>'address')) BETWEEN 1 AND 512
                AND jsonb_typeof(ext->'contact') = 'object'
                AND jsonb_typeof(ext#>'{contact,name}') = 'string'
                AND length(btrim(ext#>>'{contact,name}')) BETWEEN 1 AND 128
            WHEN 'building' THEN ext = '{}'::jsonb
            WHEN 'room' THEN jsonb_typeof(ext->'floor') = 'number'
                AND ext->>'floor' ~ '^(-[1-5]|[0-9]|[1-9][0-9]|100)$'
            WHEN 'rack' THEN
                jsonb_typeof(ext->'row') = 'string' AND ext->>'row' ~ '^([A-Z]|[1-9]|1[0-9]|2[0-5])$'
                AND jsonb_typeof(ext->'column') = 'number' AND ext->>'column' ~ '^[1-9][0-9]{0,3}$'
                AND jsonb_typeof(ext->'height_u') = 'number' AND ext->>'height_u' ~ '^([1-9]|[1-9][0-9]|100)$'
                AND CASE jsonb_typeof(ext->'power_capacity_w')
                    WHEN 'number' THEN ext->>'power_capacity_w' ~ '^[1-9][0-9]{0,9}$'
                        AND (ext->>'power_capacity_w')::numeric <= 2147483647
                    WHEN 'null' THEN true
                    ELSE NOT (ext ? 'power_capacity_w')
                END
        END) IS TRUE
    )
);
CREATE UNIQUE INDEX uidx_dc_location_root_name ON dc_location (name)
    WHERE parent IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uidx_dc_location_sibling_name ON dc_location (parent, name)
    WHERE parent IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uidx_dc_location_rack_coordinate ON dc_location (parent, (ext->>'row'), (ext->>'column'))
    WHERE type = 'rack' AND deleted_at IS NULL;

CREATE FUNCTION dc_location_validate_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    parent_status smallint;
    parent_deleted_at timestamptz;
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.type <> NEW.type OR OLD.uid <> NEW.uid) THEN
        RAISE check_violation USING MESSAGE = 'location uid and type are immutable';
    END IF;
    IF NEW.deleted_at IS NULL AND NEW.parent IS NOT NULL THEN
        SELECT status, deleted_at INTO parent_status, parent_deleted_at
        FROM dc_location WHERE uid = NEW.parent FOR SHARE;
        IF NOT FOUND OR parent_deleted_at IS NOT NULL OR (NEW.status = 1 AND parent_status <> 1) THEN
            RAISE check_violation USING MESSAGE = 'location parent is unavailable';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.deleted_at IS NOT NULL OR NEW.status = 2) THEN
        IF EXISTS (SELECT 1 FROM dc_location child WHERE child.parent = NEW.uid
            AND child.deleted_at IS NULL AND (NEW.deleted_at IS NOT NULL OR child.status = 1)) THEN
            RAISE check_violation USING MESSAGE = 'location has dependent child nodes';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER dc_location_validate_write BEFORE INSERT OR UPDATE ON dc_location
    FOR EACH ROW EXECUTE FUNCTION dc_location_validate_write();
