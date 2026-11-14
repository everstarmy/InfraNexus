ALTER TABLE part_model ADD CONSTRAINT fk_part_model_manufacturer_id FOREIGN KEY (manufacturer_id) REFERENCES org_company(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_model_manufacturer_id_norm_key ON part_model (manufacturer_id, normalized_key);
ALTER TABLE part_model ADD CONSTRAINT ck_part_model_status CHECK (status IN (1,2));
ALTER TABLE ast_device_model ADD CONSTRAINT fk_ast_device_model_manufacturer_id FOREIGN KEY (manufacturer_id) REFERENCES org_company(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_device_model_manufacturer_id_norm_key ON ast_device_model (manufacturer_id, normalized_key);
ALTER TABLE ast_device_model ADD CONSTRAINT ck_ast_device_model_status CHECK (status IN (1,2));
ALTER TABLE part_model_revision ADD CONSTRAINT fk_part_model_revision_model_id FOREIGN KEY (model_id) REFERENCES part_model(id) ON DELETE RESTRICT;
ALTER TABLE part_model_revision ADD CONSTRAINT fk_part_model_revision_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_model_revision_model_id_revision_no ON part_model_revision (model_id, revision_no);
ALTER TABLE part_model_revision ADD CONSTRAINT ck_part_model_revision_state CHECK (state IN ('draft','published') AND revision_no>0 AND ((state='published')=(published_at IS NOT NULL AND published_by IS NOT NULL)));
ALTER TABLE ast_device_model_revision ADD CONSTRAINT fk_ast_device_model_revision_model_id FOREIGN KEY (model_id) REFERENCES ast_device_model(id) ON DELETE RESTRICT;
ALTER TABLE ast_device_model_revision ADD CONSTRAINT fk_ast_device_model_revision_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_device_model_revision_model_id_revision_no ON ast_device_model_revision (model_id, revision_no);
ALTER TABLE ast_device_model_revision ADD CONSTRAINT ck_ast_device_model_revision_state CHECK (state IN ('draft','published') AND revision_no>0 AND ((state='published')=(published_at IS NOT NULL AND published_by IS NOT NULL)));
ALTER TABLE ast_model_slot_template ADD CONSTRAINT fk_ast_model_slot_template_revision_id FOREIGN KEY (revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_model_port_template ADD CONSTRAINT fk_ast_model_port_template_revision_id FOREIGN KEY (revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_model_standard_component ADD CONSTRAINT fk_ast_model_standard_component_revision_id FOREIGN KEY (revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE part_compatibility ADD CONSTRAINT fk_part_compatibility_revision_id FOREIGN KEY (revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_model_standard_component ADD CONSTRAINT fk_ast_model_standard_component_part_model_revision_id FOREIGN KEY (part_model_revision_id) REFERENCES part_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE part_compatibility ADD CONSTRAINT fk_part_compatibility_part_model_revision_id FOREIGN KEY (part_model_revision_id) REFERENCES part_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_purchase_line_component ADD CONSTRAINT fk_ast_purchase_line_component_part_model_revision_id FOREIGN KEY (part_model_revision_id) REFERENCES part_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_component ADD CONSTRAINT fk_ast_receipt_component_part_model_revision_id FOREIGN KEY (part_model_revision_id) REFERENCES part_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE part_item ADD CONSTRAINT fk_part_item_part_model_revision_id FOREIGN KEY (part_model_revision_id) REFERENCES part_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_baseline_item ADD CONSTRAINT fk_ast_receipt_baseline_item_part_model_revision_id FOREIGN KEY (part_model_revision_id) REFERENCES part_model_revision(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_model_slot_template_revision_id_stable_key ON ast_model_slot_template (revision_id, stable_key);
CREATE UNIQUE INDEX ux_ast_model_port_template_revision_id_stable_key ON ast_model_port_template (revision_id, stable_key);
ALTER TABLE ast_model_slot_template ADD CONSTRAINT uq_model_slot_key UNIQUE(revision_id,stable_key);
ALTER TABLE ast_model_port_template ADD CONSTRAINT fk_ast_model_port_template_slot FOREIGN KEY(revision_id,slot_key) REFERENCES ast_model_slot_template(revision_id,stable_key);
ALTER TABLE ast_model_standard_component ADD CONSTRAINT fk_ast_model_standard_component_slot FOREIGN KEY(revision_id,slot_key) REFERENCES ast_model_slot_template(revision_id,stable_key);
ALTER TABLE part_compatibility ADD CONSTRAINT fk_part_compatibility_slot FOREIGN KEY(revision_id,slot_key) REFERENCES ast_model_slot_template(revision_id,stable_key);
CREATE UNIQUE INDEX ux_compatibility_pair ON part_compatibility(revision_id,slot_key,part_model_revision_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX ux_ast_model_standard_component_revision_id_slot_key ON ast_model_standard_component (revision_id, slot_key) WHERE slot_key IS NOT NULL;
ALTER TABLE ast_model_standard_component ADD CONSTRAINT ck_ast_model_standard_component_quantity CHECK (quantity>0 AND (slot_key IS NULL OR quantity=1));
ALTER TABLE part_compatibility ADD CONSTRAINT ck_part_compatibility_state CHECK (status IN ('pending','confirmed','incompatible'));
ALTER TABLE part_compatibility ADD CONSTRAINT fk_part_compatibility_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ast_purchase_batch ADD CONSTRAINT fk_ast_purchase_batch_supplier_id FOREIGN KEY (supplier_id) REFERENCES org_company(id) ON DELETE RESTRICT;
ALTER TABLE ast_purchase_batch ADD CONSTRAINT fk_ast_purchase_batch_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_purchase_batch_number ON ast_purchase_batch (number);
ALTER TABLE ast_purchase_batch ADD CONSTRAINT ck_ast_purchase_batch_state CHECK (state IN ('draft','open','completed','closed','canceled'));
ALTER TABLE ast_purchase_line ADD CONSTRAINT fk_ast_purchase_line_purchase_batch_id FOREIGN KEY (purchase_batch_id) REFERENCES ast_purchase_batch(id) ON DELETE RESTRICT;
ALTER TABLE ast_purchase_line ADD CONSTRAINT fk_ast_purchase_line_device_model_revision_id FOREIGN KEY (device_model_revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_purchase_line_purchase_batch_id_line_no ON ast_purchase_line (purchase_batch_id, line_no);
ALTER TABLE ast_purchase_line ADD CONSTRAINT ck_ast_purchase_line_quantity CHECK (planned_quantity BETWEEN 1 AND 10000 AND accepted_quantity BETWEEN 0 AND planned_quantity);
ALTER TABLE ast_purchase_line_component ADD CONSTRAINT fk_ast_purchase_line_component_purchase_line_id FOREIGN KEY (purchase_line_id) REFERENCES ast_purchase_line(id) ON DELETE RESTRICT;
ALTER TABLE ast_purchase_line_component ADD CONSTRAINT ck_ast_purchase_line_component_quantity CHECK (quantity>0 AND (slot_key IS NULL OR quantity=1));
ALTER TABLE ast_receipt ADD CONSTRAINT fk_ast_receipt_purchase_batch_id FOREIGN KEY (purchase_batch_id) REFERENCES ast_purchase_batch(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt ADD CONSTRAINT fk_ast_receipt_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt ADD CONSTRAINT fk_ast_receipt_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_receipt_number ON ast_receipt (number);
ALTER TABLE ast_receipt ADD CONSTRAINT ck_ast_receipt_state CHECK (state IN ('draft','completed','canceled'));
ALTER TABLE ast_receipt_item ADD CONSTRAINT fk_ast_receipt_item_receipt_id FOREIGN KEY (receipt_id) REFERENCES ast_receipt(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_item ADD CONSTRAINT fk_ast_receipt_item_purchase_line_id FOREIGN KEY (purchase_line_id) REFERENCES ast_purchase_line(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_item ADD CONSTRAINT fk_ast_receipt_item_device_model_revision_id FOREIGN KEY (device_model_revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_item ADD CONSTRAINT fk_ast_receipt_item_custody_location_id FOREIGN KEY (custody_location_id) REFERENCES ast_custody_location(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_item ADD CONSTRAINT ck_ast_receipt_item_result CHECK (inspection_result IN ('pending','pass','reject'));
ALTER TABLE ast_receipt_component ADD CONSTRAINT fk_ast_receipt_component_receipt_item_id FOREIGN KEY (receipt_item_id) REFERENCES ast_receipt_item(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_component ADD CONSTRAINT fk_ast_receipt_component_custody_location_id FOREIGN KEY (custody_location_id) REFERENCES ast_custody_location(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_component ADD CONSTRAINT ck_ast_receipt_component_placement CHECK ((initial_placement='installed' AND custody_location_id IS NULL) OR (initial_placement='stored' AND custody_location_id IS NOT NULL AND slot_key IS NULL));
CREATE UNIQUE INDEX ux_ast_receipt_component_receipt_item_id_slot_key ON ast_receipt_component (receipt_item_id, slot_key) WHERE slot_key IS NOT NULL;
ALTER TABLE ast_custody_location ADD CONSTRAINT fk_ast_custody_location_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES dc_warehouse(id) ON DELETE RESTRICT;
ALTER TABLE ast_custody_location ADD CONSTRAINT fk_ast_custody_location_bin_id FOREIGN KEY (bin_id) REFERENCES dc_bin(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_custody_location_warehouse_id ON ast_custody_location (warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE UNIQUE INDEX ux_ast_custody_location_bin_id ON ast_custody_location (bin_id) WHERE bin_id IS NOT NULL;
ALTER TABLE ast_custody_location ADD CONSTRAINT ck_ast_custody_location_target CHECK ((kind='warehouse' AND warehouse_id IS NOT NULL AND bin_id IS NULL) OR (kind='bin' AND warehouse_id IS NULL AND bin_id IS NOT NULL));
ALTER TABLE ast_device ADD CONSTRAINT fk_ast_device_id FOREIGN KEY (id) REFERENCES res_object(id) ON DELETE RESTRICT;
ALTER TABLE ast_device ADD CONSTRAINT fk_ast_device_manufacturer_id FOREIGN KEY (manufacturer_id) REFERENCES org_company(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_device_manufacturer_id_norm_sn ON ast_device (manufacturer_id, normalized_sn) WHERE normalized_sn IS NOT NULL;
ALTER TABLE ast_device ADD CONSTRAINT ck_ast_device_sn CHECK ((serial_number IS NULL)=(normalized_sn IS NULL) AND (normalized_sn IS NULL OR normalized_sn <> ''));
ALTER TABLE part_item ADD CONSTRAINT fk_part_item_id FOREIGN KEY (id) REFERENCES res_object(id) ON DELETE RESTRICT;
ALTER TABLE part_item ADD CONSTRAINT fk_part_item_manufacturer_id FOREIGN KEY (manufacturer_id) REFERENCES org_company(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_item_manufacturer_id_norm_sn ON part_item (manufacturer_id, normalized_sn) WHERE normalized_sn IS NOT NULL;
ALTER TABLE part_item ADD CONSTRAINT ck_part_item_sn CHECK ((serial_number IS NULL)=(normalized_sn IS NULL) AND (normalized_sn IS NULL OR normalized_sn <> ''));
ALTER TABLE ast_device ADD CONSTRAINT fk_ast_device_device_model_revision_id FOREIGN KEY (device_model_revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_device ADD CONSTRAINT fk_ast_device_supplier_id FOREIGN KEY (supplier_id) REFERENCES org_company(id) ON DELETE RESTRICT;
ALTER TABLE ast_device ADD CONSTRAINT fk_ast_device_source_receipt_item_id FOREIGN KEY (source_receipt_item_id) REFERENCES ast_receipt_item(id) ON DELETE RESTRICT;
ALTER TABLE ast_device ADD CONSTRAINT fk_ast_device_current_custody_location_id FOREIGN KEY (current_custody_location_id) REFERENCES ast_custody_location(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_device_asset_code ON ast_device (asset_code);
CREATE UNIQUE INDEX ux_ast_device_source_receipt_item_id ON ast_device (source_receipt_item_id);
ALTER TABLE part_item ADD CONSTRAINT fk_part_item_source_receipt_component_id FOREIGN KEY (source_receipt_component_id) REFERENCES ast_receipt_component(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_item_internal_code ON part_item (internal_code);
CREATE UNIQUE INDEX ux_part_item_source_receipt_component_id ON part_item (source_receipt_component_id);
ALTER TABLE ast_receipt_baseline ADD CONSTRAINT fk_ast_receipt_baseline_device_id FOREIGN KEY (device_id) REFERENCES ast_device(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_baseline ADD CONSTRAINT fk_ast_receipt_baseline_receipt_item_id FOREIGN KEY (receipt_item_id) REFERENCES ast_receipt_item(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_baseline ADD CONSTRAINT fk_ast_receipt_baseline_device_model_revision_id FOREIGN KEY (device_model_revision_id) REFERENCES ast_device_model_revision(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_baseline ADD CONSTRAINT fk_ast_receipt_baseline_accepted_by FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_baseline ADD CONSTRAINT fk_ast_receipt_baseline_action_id FOREIGN KEY (action_id) REFERENCES ast_asset_action(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_receipt_baseline_device_id ON ast_receipt_baseline (device_id);
CREATE UNIQUE INDEX ux_ast_receipt_baseline_receipt_item_id ON ast_receipt_baseline (receipt_item_id);
ALTER TABLE ast_receipt_baseline_item ADD CONSTRAINT fk_ast_receipt_baseline_item_baseline_id FOREIGN KEY (baseline_id) REFERENCES ast_receipt_baseline(id) ON DELETE RESTRICT;
ALTER TABLE ast_receipt_baseline_item ADD CONSTRAINT fk_ast_receipt_baseline_item_part_item_id FOREIGN KEY (part_item_id) REFERENCES part_item(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_receipt_baseline_item_part_item_id ON ast_receipt_baseline_item (part_item_id);
ALTER TABLE part_slot_allocation ADD CONSTRAINT fk_part_slot_allocation_part_item_id FOREIGN KEY (part_item_id) REFERENCES part_item(id) ON DELETE RESTRICT;
ALTER TABLE part_slot_allocation ADD CONSTRAINT fk_part_slot_allocation_device_id FOREIGN KEY (device_id) REFERENCES ast_device(id) ON DELETE RESTRICT;
ALTER TABLE part_slot_allocation ADD CONSTRAINT fk_part_slot_allocation_start_action_id FOREIGN KEY (start_action_id) REFERENCES ast_asset_action(id) ON DELETE RESTRICT;
ALTER TABLE part_slot_allocation ADD CONSTRAINT fk_part_slot_allocation_end_action_id FOREIGN KEY (end_action_id) REFERENCES ast_asset_action(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_slot_allocation_part_item_id ON part_slot_allocation (part_item_id) WHERE ended_recorded_at IS NULL;
CREATE UNIQUE INDEX ux_part_slot_allocation_device_id_slot_key ON part_slot_allocation (device_id, slot_key) WHERE ended_recorded_at IS NULL AND slot_key IS NOT NULL;
ALTER TABLE part_slot_allocation ADD CONSTRAINT ck_part_slot_allocation_end CHECK ((ended_recorded_at IS NULL)=(end_action_id IS NULL) AND (removed_at IS NULL OR ended_recorded_at IS NOT NULL) AND (installed_at IS NULL OR removed_at IS NULL OR installed_at<=removed_at));
ALTER TABLE part_current_placement ADD CONSTRAINT fk_part_current_placement_part_item_id FOREIGN KEY (part_item_id) REFERENCES part_item(id) ON DELETE RESTRICT;
ALTER TABLE part_current_placement ADD CONSTRAINT fk_part_current_placement_allocation_id FOREIGN KEY (allocation_id) REFERENCES part_slot_allocation(id) ON DELETE RESTRICT;
ALTER TABLE part_current_placement ADD CONSTRAINT fk_part_current_placement_custody_location_id FOREIGN KEY (custody_location_id) REFERENCES ast_custody_location(id) ON DELETE RESTRICT;
ALTER TABLE part_current_placement ADD CONSTRAINT fk_part_current_placement_last_action_id FOREIGN KEY (last_action_id) REFERENCES ast_asset_action(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_current_placement_part_item_id ON part_current_placement (part_item_id);
CREATE UNIQUE INDEX ux_part_current_placement_allocation_id ON part_current_placement (allocation_id) WHERE allocation_id IS NOT NULL;
ALTER TABLE part_current_placement ADD CONSTRAINT ck_part_current_placement_target CHECK ((kind='installed' AND allocation_id IS NOT NULL AND custody_location_id IS NULL) OR (kind='stored' AND allocation_id IS NULL AND custody_location_id IS NOT NULL));
ALTER TABLE ast_asset_action ADD CONSTRAINT fk_ast_asset_action_actor_user_id FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ast_asset_action ADD CONSTRAINT fk_ast_asset_action_receipt_id FOREIGN KEY (receipt_id) REFERENCES ast_receipt(id) ON DELETE RESTRICT;
ALTER TABLE part_movement_event ADD CONSTRAINT fk_part_movement_event_part_item_id FOREIGN KEY (part_item_id) REFERENCES part_item(id) ON DELETE RESTRICT;
ALTER TABLE part_movement_event ADD CONSTRAINT fk_part_movement_event_action_id FOREIGN KEY (action_id) REFERENCES ast_asset_action(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_movement_event_part_item_id_action_id ON part_movement_event (part_item_id, action_id);
ALTER TABLE part_identity_event ADD CONSTRAINT fk_part_identity_event_part_item_id FOREIGN KEY (part_item_id) REFERENCES part_item(id) ON DELETE RESTRICT;
ALTER TABLE part_identity_event ADD CONSTRAINT fk_part_identity_event_action_id FOREIGN KEY (action_id) REFERENCES ast_asset_action(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_part_identity_event_part_item_id_action_id ON part_identity_event (part_item_id, action_id);
ALTER TABLE part_movement_event ADD CONSTRAINT fk_part_movement_event_from_device_id FOREIGN KEY (from_device_id) REFERENCES ast_device(id) ON DELETE RESTRICT;
ALTER TABLE part_movement_event ADD CONSTRAINT fk_part_movement_event_to_device_id FOREIGN KEY (to_device_id) REFERENCES ast_device(id) ON DELETE RESTRICT;
ALTER TABLE part_movement_event ADD CONSTRAINT fk_part_movement_event_from_custody_location_id FOREIGN KEY (from_custody_location_id) REFERENCES ast_custody_location(id) ON DELETE RESTRICT;
ALTER TABLE part_movement_event ADD CONSTRAINT fk_part_movement_event_to_custody_location_id FOREIGN KEY (to_custody_location_id) REFERENCES ast_custody_location(id) ON DELETE RESTRICT;
ALTER TABLE part_identity_event ADD CONSTRAINT fk_part_identity_event_actor_user_id FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE core_attachment ADD CONSTRAINT fk_core_attachment_receipt_item_id FOREIGN KEY (receipt_item_id) REFERENCES ast_receipt_item(id) ON DELETE RESTRICT;
ALTER TABLE core_attachment ADD CONSTRAINT fk_core_attachment_baseline_id FOREIGN KEY (baseline_id) REFERENCES ast_receipt_baseline(id) ON DELETE RESTRICT;
ALTER TABLE core_attachment ADD CONSTRAINT fk_core_attachment_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE core_attachment ADD CONSTRAINT ck_core_attachment_size CHECK (size_bytes BETWEEN 1 AND 10485760 AND octet_length(content)=size_bytes);
ALTER TABLE ast_command_receipt ADD CONSTRAINT fk_ast_command_receipt_actor_user_id FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_ast_command_receipt_actor_user_id_operation_target_scope_key ON ast_command_receipt (actor_user_id, operation, target_scope, key);

CREATE FUNCTION receiving_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable receiving record' USING ERRCODE='23514'; END $$;
CREATE FUNCTION receiving_model_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text; old_parent_state text;
BEGIN
 IF TG_NARGS=0 THEN
  IF OLD.state='published' THEN RAISE EXCEPTION 'published revision is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP <> 'INSERT' THEN
   SELECT state INTO old_parent_state FROM ast_device_model_revision WHERE id=OLD.revision_id FOR UPDATE;
  END IF;
  IF TG_OP <> 'DELETE' THEN
   SELECT state INTO parent_state FROM ast_device_model_revision WHERE id=NEW.revision_id FOR UPDATE;
  END IF;
  IF parent_state='published' OR old_parent_state='published' THEN RAISE EXCEPTION 'published template is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE FUNCTION receiving_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; oldrid uuid; s text;
BEGIN
 IF TG_TABLE_NAME='ast_receipt' THEN
  IF OLD.state<>'draft' THEN RAISE EXCEPTION 'receipt is frozen' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_TABLE_NAME='ast_receipt_item' THEN
   IF TG_OP<>'DELETE' THEN rid:=NEW.receipt_id; END IF;
   IF TG_OP<>'INSERT' THEN oldrid:=OLD.receipt_id; END IF;
  ELSE
   IF TG_OP<>'DELETE' THEN SELECT receipt_id INTO rid FROM ast_receipt_item WHERE id=NEW.receipt_item_id; END IF;
   IF TG_OP<>'INSERT' THEN SELECT receipt_id INTO oldrid FROM ast_receipt_item WHERE id=OLD.receipt_item_id; END IF;
  END IF;
  FOR s IN SELECT state FROM ast_receipt WHERE id IN(rid,oldrid) ORDER BY id FOR UPDATE LOOP
   IF s<>'draft' THEN RAISE EXCEPTION 'receipt is frozen' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE FUNCTION receiving_item_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ast_receipt r JOIN ast_purchase_line l ON l.purchase_batch_id=r.purchase_batch_id WHERE r.id=NEW.receipt_id AND l.id=NEW.purchase_line_id AND l.device_model_revision_id=NEW.device_model_revision_id) THEN
 RAISE EXCEPTION 'receipt line parent mismatch' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER receipt_item_parent BEFORE INSERT OR UPDATE ON ast_receipt_item FOR EACH ROW EXECUTE FUNCTION receiving_item_parent();
CREATE FUNCTION receiving_placement_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid; p part_current_placement%ROWTYPE; a part_slot_allocation%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='part_item' THEN pid:=NEW.id; ELSE pid:=COALESCE(NEW.part_item_id,OLD.part_item_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM part_item WHERE id=pid) THEN RETURN NULL; END IF;
 SELECT * INTO p FROM part_current_placement WHERE part_item_id=pid;
 IF NOT FOUND THEN RAISE EXCEPTION 'component placement missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM part_slot_allocation WHERE part_item_id=pid AND ended_recorded_at IS NULL;
 IF p.kind='installed' AND (a.id IS NULL OR a.id<>p.allocation_id) OR p.kind='stored' AND a.id IS NOT NULL THEN
 RAISE EXCEPTION 'component placement mismatch' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
CREATE FUNCTION receiving_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_mfr uuid; typ text;
BEGIN
 SELECT object_type INTO typ FROM res_object WHERE id=NEW.id;
 IF TG_TABLE_NAME='ast_device' THEN
 SELECT m.manufacturer_id INTO expected_mfr FROM ast_device_model_revision r JOIN ast_device_model m ON m.id=r.model_id WHERE r.id=NEW.device_model_revision_id;
 IF typ<>'device' THEN RAISE EXCEPTION 'object type mismatch' USING ERRCODE='23514'; END IF;
 ELSE
 SELECT m.manufacturer_id INTO expected_mfr FROM part_model_revision r JOIN part_model m ON m.id=r.model_id WHERE r.id=NEW.part_model_revision_id;
 IF typ<>'component' THEN RAISE EXCEPTION 'object type mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF expected_mfr IS DISTINCT FROM NEW.manufacturer_id THEN RAISE EXCEPTION 'manufacturer mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER immutable_ast_receipt_baseline BEFORE UPDATE OR DELETE ON ast_receipt_baseline FOR EACH ROW EXECUTE FUNCTION receiving_immutable();
CREATE TRIGGER immutable_ast_receipt_baseline_item BEFORE UPDATE OR DELETE ON ast_receipt_baseline_item FOR EACH ROW EXECUTE FUNCTION receiving_immutable();
CREATE TRIGGER immutable_ast_asset_action BEFORE UPDATE OR DELETE ON ast_asset_action FOR EACH ROW EXECUTE FUNCTION receiving_immutable();
CREATE TRIGGER immutable_part_movement_event BEFORE UPDATE OR DELETE ON part_movement_event FOR EACH ROW EXECUTE FUNCTION receiving_immutable();
CREATE TRIGGER immutable_part_identity_event BEFORE UPDATE OR DELETE ON part_identity_event FOR EACH ROW EXECUTE FUNCTION receiving_immutable();
CREATE TRIGGER immutable_ast_command_receipt BEFORE UPDATE OR DELETE ON ast_command_receipt FOR EACH ROW EXECUTE FUNCTION receiving_immutable();
CREATE TRIGGER immutable_res_object BEFORE UPDATE OR DELETE ON res_object FOR EACH ROW EXECUTE FUNCTION receiving_immutable();
CREATE TRIGGER frozen_part_model_revision BEFORE UPDATE OR DELETE ON part_model_revision FOR EACH ROW EXECUTE FUNCTION receiving_model_frozen();
CREATE TRIGGER frozen_ast_device_model_revision BEFORE UPDATE OR DELETE ON ast_device_model_revision FOR EACH ROW EXECUTE FUNCTION receiving_model_frozen();
CREATE TRIGGER frozen_ast_model_slot_template BEFORE INSERT OR UPDATE OR DELETE ON ast_model_slot_template FOR EACH ROW EXECUTE FUNCTION receiving_model_frozen('child');
CREATE TRIGGER frozen_ast_model_port_template BEFORE INSERT OR UPDATE OR DELETE ON ast_model_port_template FOR EACH ROW EXECUTE FUNCTION receiving_model_frozen('child');
CREATE TRIGGER frozen_ast_model_standard_component BEFORE INSERT OR UPDATE OR DELETE ON ast_model_standard_component FOR EACH ROW EXECUTE FUNCTION receiving_model_frozen('child');
CREATE TRIGGER frozen_part_compatibility BEFORE INSERT OR UPDATE OR DELETE ON part_compatibility FOR EACH ROW EXECUTE FUNCTION receiving_model_frozen('child');
CREATE TRIGGER draft_ast_receipt_item BEFORE INSERT OR UPDATE OR DELETE ON ast_receipt_item FOR EACH ROW EXECUTE FUNCTION receiving_draft_guard();
CREATE TRIGGER draft_ast_receipt_component BEFORE INSERT OR UPDATE OR DELETE ON ast_receipt_component FOR EACH ROW EXECUTE FUNCTION receiving_draft_guard();
CREATE TRIGGER draft_core_attachment BEFORE INSERT OR UPDATE OR DELETE ON core_attachment FOR EACH ROW EXECUTE FUNCTION receiving_draft_guard();
CREATE TRIGGER frozen_receipt BEFORE UPDATE OR DELETE ON ast_receipt FOR EACH ROW EXECUTE FUNCTION receiving_draft_guard();
CREATE CONSTRAINT TRIGGER consistent_part_item AFTER INSERT OR UPDATE OR DELETE ON part_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receiving_placement_consistent();
CREATE CONSTRAINT TRIGGER consistent_part_slot_allocation AFTER INSERT OR UPDATE OR DELETE ON part_slot_allocation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receiving_placement_consistent();
CREATE CONSTRAINT TRIGGER consistent_part_current_placement AFTER INSERT OR UPDATE OR DELETE ON part_current_placement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receiving_placement_consistent();
CREATE TRIGGER identity_part_item BEFORE INSERT OR UPDATE ON part_item FOR EACH ROW EXECUTE FUNCTION receiving_identity_guard();
CREATE TRIGGER identity_ast_device BEFORE INSERT OR UPDATE ON ast_device FOR EACH ROW EXECUTE FUNCTION receiving_identity_guard();
CREATE INDEX ix_ast_receipt_parent ON ast_receipt(purchase_batch_id,created_at DESC,id DESC);
CREATE INDEX ix_ast_receipt_item_parent ON ast_receipt_item(receipt_id,created_at DESC,id DESC);
CREATE INDEX ix_ast_receipt_component_parent ON ast_receipt_component(receipt_item_id,created_at DESC,id DESC);
CREATE INDEX ix_part_slot_allocation_parent ON part_slot_allocation(device_id,created_at DESC,id DESC);
CREATE INDEX ix_ast_asset_action_parent ON ast_asset_action(resource_id,created_at DESC,id DESC);
CREATE INDEX ix_core_attachment_parent ON core_attachment(receipt_item_id,created_at DESC,id DESC);

-- Keep historical relation identities stable while allowing a future movement
-- command to end an allocation and change the component's current projection.
CREATE FUNCTION receiving_relation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'asset history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='part_slot_allocation' THEN
  IF NEW.part_item_id<>OLD.part_item_id OR NEW.device_id<>OLD.device_id OR NEW.slot_key IS DISTINCT FROM OLD.slot_key OR NEW.start_action_id<>OLD.start_action_id OR OLD.ended_recorded_at IS NOT NULL THEN
   RAISE EXCEPTION 'installation identity cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='part_current_placement' THEN
  IF NEW.part_item_id<>OLD.part_item_id THEN RAISE EXCEPTION 'placement identity cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='part_item' THEN
  IF NEW.part_model_revision_id<>OLD.part_model_revision_id OR NEW.manufacturer_id<>OLD.manufacturer_id OR NEW.source_receipt_component_id<>OLD.source_receipt_component_id OR NEW.internal_code<>OLD.internal_code THEN
   RAISE EXCEPTION 'component identity cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='ast_device' THEN
  IF NEW.device_model_revision_id<>OLD.device_model_revision_id OR NEW.manufacturer_id<>OLD.manufacturer_id OR NEW.source_receipt_item_id<>OLD.source_receipt_item_id OR NEW.normalized_sn<>OLD.normalized_sn OR NEW.asset_code<>OLD.asset_code THEN
   RAISE EXCEPTION 'device identity cannot change' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER relation_identity BEFORE UPDATE OR DELETE ON part_slot_allocation FOR EACH ROW EXECUTE FUNCTION receiving_relation_identity();
CREATE TRIGGER placement_identity BEFORE UPDATE OR DELETE ON part_current_placement FOR EACH ROW EXECUTE FUNCTION receiving_relation_identity();
CREATE TRIGGER part_identity BEFORE UPDATE OR DELETE ON part_item FOR EACH ROW EXECUTE FUNCTION receiving_relation_identity();
CREATE TRIGGER device_identity BEFORE UPDATE OR DELETE ON ast_device FOR EACH ROW EXECUTE FUNCTION receiving_relation_identity();
CREATE FUNCTION receiving_order_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text; parent_id uuid;
BEGIN
 IF TG_TABLE_NAME='ast_purchase_batch' THEN
  IF OLD.state<>'draft' AND (NEW.name<>OLD.name OR NEW.supplier_id<>OLD.supplier_id OR NEW.external_order_no IS DISTINCT FROM OLD.external_order_no OR NEW.expected_arrival_date IS DISTINCT FROM OLD.expected_arrival_date OR NEW.description<>OLD.description) THEN
   RAISE EXCEPTION 'opened purchase plan is frozen' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='ast_purchase_line' THEN
  parent_id:=COALESCE(NEW.purchase_batch_id,OLD.purchase_batch_id);
  SELECT state INTO parent_state FROM ast_purchase_batch WHERE id=parent_id FOR UPDATE;
  IF parent_state<>'draft' AND (TG_OP<>'UPDATE' OR NEW.planned_quantity<>OLD.planned_quantity OR NEW.device_model_revision_id<>OLD.device_model_revision_id OR NEW.purchase_batch_id<>OLD.purchase_batch_id OR NEW.line_no<>OLD.line_no OR NEW.note<>OLD.note) THEN
   RAISE EXCEPTION 'opened purchase line is frozen' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT b.state INTO parent_state FROM ast_purchase_line l JOIN ast_purchase_batch b ON b.id=l.purchase_batch_id WHERE l.id=COALESCE(NEW.purchase_line_id,OLD.purchase_line_id) FOR UPDATE OF b;
  IF parent_state<>'draft' THEN RAISE EXCEPTION 'opened purchase configuration is frozen' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER purchase_plan_frozen BEFORE UPDATE ON ast_purchase_batch FOR EACH ROW EXECUTE FUNCTION receiving_order_frozen();
CREATE TRIGGER purchase_line_frozen BEFORE INSERT OR UPDATE OR DELETE ON ast_purchase_line FOR EACH ROW EXECUTE FUNCTION receiving_order_frozen();
CREATE TRIGGER purchase_component_frozen BEFORE INSERT OR UPDATE OR DELETE ON ast_purchase_line_component FOR EACH ROW EXECUTE FUNCTION receiving_order_frozen();

CREATE UNIQUE INDEX ux_arrival_component_slot ON ast_purchase_line_component(purchase_line_id,slot_key) WHERE slot_key IS NOT NULL;
CREATE INDEX ix_original_members ON ast_receipt_baseline_item(baseline_id,created_at DESC,id DESC);
CREATE INDEX ix_arrival_components ON ast_purchase_line_component(purchase_line_id,created_at DESC,id DESC);
CREATE INDEX ix_component_versions ON part_model_revision(model_id,revision_no DESC);
CREATE INDEX ix_device_versions ON ast_device_model_revision(model_id,revision_no DESC);
CREATE INDEX ix_receipt_results ON ast_receipt_item(purchase_line_id,inspection_result);
CREATE INDEX ix_part_identity_history ON part_identity_event(part_item_id,recorded_at DESC,id DESC);
CREATE INDEX ix_part_movement_history ON part_movement_event(part_item_id,recorded_at DESC,id DESC);
CREATE FUNCTION receiving_final_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item_id uuid; receipt_state text; outcome text;
BEGIN
 IF TG_TABLE_NAME='ast_device' THEN
  item_id:=NEW.source_receipt_item_id;
  IF NOT EXISTS(SELECT 1 FROM ast_receipt_baseline WHERE device_id=NEW.id AND receipt_item_id=item_id) THEN
   RAISE EXCEPTION 'device baseline missing' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT receipt_item_id INTO item_id FROM ast_receipt_component WHERE id=NEW.source_receipt_component_id;
  IF NOT EXISTS(SELECT 1 FROM ast_receipt_baseline_item bi JOIN ast_receipt_baseline b ON b.id=bi.baseline_id WHERE bi.part_item_id=NEW.id AND b.receipt_item_id=item_id) THEN
   RAISE EXCEPTION 'component baseline missing' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT r.state,i.inspection_result INTO receipt_state,outcome FROM ast_receipt_item i JOIN ast_receipt r ON r.id=i.receipt_id WHERE i.id=item_id;
 IF receipt_state IS DISTINCT FROM 'completed' OR outcome IS DISTINCT FROM 'pass' THEN RAISE EXCEPTION 'unaccepted source' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER final_device_source AFTER INSERT ON ast_device DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receiving_final_source();
CREATE CONSTRAINT TRIGGER final_part_source AFTER INSERT ON part_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receiving_final_source();
CREATE FUNCTION receiving_quantity_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual bigint; accepted integer;
BEGIN
 SELECT accepted_quantity INTO accepted FROM ast_purchase_line WHERE id=NEW.id;
 SELECT count(*) INTO actual FROM ast_device d JOIN ast_receipt_item i ON i.id=d.source_receipt_item_id WHERE i.purchase_line_id=NEW.id;
 IF accepted IS DISTINCT FROM actual THEN RAISE EXCEPTION 'accepted quantity does not match assets' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER accepted_quantity_consistent AFTER INSERT OR UPDATE ON ast_purchase_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receiving_quantity_consistent();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['part_model','ast_device_model','part_model_revision','ast_device_model_revision','ast_model_slot_template','ast_model_port_template','ast_model_standard_component','part_compatibility','ast_purchase_batch','ast_purchase_line','ast_purchase_line_component','ast_receipt','ast_receipt_item','ast_receipt_component','ast_custody_location','res_object','ast_device','part_item','ast_receipt_baseline','ast_receipt_baseline_item','part_slot_allocation','part_current_placement','ast_asset_action','part_movement_event','part_identity_event','core_attachment','ast_command_receipt'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT version_positive CHECK(version>0)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['ast_receipt_item','ast_receipt_component','ast_device','part_item'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT sn_rule_valid CHECK(sn_rule_version=1 AND (serial_number IS NULL)=(normalized_sn IS NULL) AND (serial_number IS NULL OR (serial_number ~ ''^[!-~]+$'' AND normalized_sn=upper(serial_number))))',t);
 END LOOP;
END $$;
