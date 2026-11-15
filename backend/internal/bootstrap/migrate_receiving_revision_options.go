package bootstrap

import "gorm.io/gorm"

const migrationReceivingRevisionOptions = "20261115_v14_device_revision_options"

func migrateReceivingRevisionOptions(tx *gorm.DB) error {
	return tx.Exec(`
ALTER TABLE ast_device_model_revision
 ADD COLUMN IF NOT EXISTS name varchar(128) NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS description varchar(1024) NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS status integer NOT NULL DEFAULT 1;
ALTER TABLE part_model_revision
 ADD COLUMN IF NOT EXISTS name varchar(128) NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS description varchar(1024) NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS status integer NOT NULL DEFAULT 1;
ALTER TABLE ast_device_model_revision ADD CONSTRAINT ck_ast_device_model_revision_status CHECK (status IN (1, 2));
DROP TRIGGER frozen_ast_device_model_revision ON ast_device_model_revision;
UPDATE ast_device_model_revision SET name = '版本 ' || revision_no;
CREATE FUNCTION receiving_device_revision_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state = 'published' THEN
  IF TG_OP = 'DELETE' THEN
   RAISE EXCEPTION 'published revision is immutable' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'version', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'version', 'updated_at']) THEN
   RAISE EXCEPTION 'published revision is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER frozen_ast_device_model_revision BEFORE UPDATE OR DELETE
 ON ast_device_model_revision FOR EACH ROW EXECUTE FUNCTION receiving_device_revision_frozen();
`).Error
}
