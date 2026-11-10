package bootstrap

import (
	"fmt"

	"gorm.io/gorm"

	"infranexus/internal/domain"
)

const migrationLocationIPAMVendors = "20261109_v05_dcim_foundation"

func migrateLocationIPAMVendors(tx *gorm.DB) error {
	if err := tx.AutoMigrate(
		&domain.Datacenter{}, &domain.Building{}, &domain.Floor{}, &domain.Room{}, &domain.RackRow{}, &domain.Rack{},
		&domain.Warehouse{}, &domain.Shelf{}, &domain.Bin{}, &domain.TemporaryLocation{}, &domain.RackUnitAllocation{},
		&domain.NetworkScope{}, &domain.SecurityZone{}, &domain.Subnet{}, &domain.RackSubnetBinding{}, &domain.IPAddress{}, &domain.IPConflict{},
		&domain.Manufacturer{}, &domain.Vendor{}, &domain.OrganizationContact{}, &domain.VendorQualification{}, &domain.ContactCertification{},
		&domain.ManagedAudit{}, &domain.ManagedReceipt{},
	); err != nil {
		return fmt.Errorf("create managed schema: %w", err)
	}
	for _, ref := range domain.ManagedReferences() {
		// All identifiers come from the static domain registry.
		if err := tx.Exec(fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT fk_%s_%s FOREIGN KEY (%s) REFERENCES %s(id) ON DELETE RESTRICT",
			ref.Table, ref.Table, ref.Column, ref.Column, ref.Target)).Error; err != nil {
			return fmt.Errorf("add %s.%s reference: %w", ref.Table, ref.Column, err)
		}
	}
	indexes := []struct{ table, columns string }{
		{"dc_datacenter", "code"}, {"dc_building", "datacenter_id, code"}, {"dc_floor", "building_id, code"},
		{"dc_room", "datacenter_id, code"}, {"dc_rack_row", "room_id, code"}, {"dc_rack", "room_id, code"},
		{"dc_warehouse", "datacenter_id, code"}, {"dc_shelf", "warehouse_id, code"}, {"dc_bin", "shelf_id, code"},
		{"dc_temporary_location", "datacenter_id, code"}, {"ipam_network_scope", "code"}, {"ipam_security_zone", "datacenter_id, code"},
		{"ipam_subnet", "network_scope_id, code"}, {"ipam_rack_subnet_binding", "rack_id, code"},
		{"org_manufacturer", "code"}, {"org_vendor", "code"}, {"org_vendor_qualification", "vendor_id, code"},
		{"org_contact_certification", "contact_id, code"},
	}
	for _, index := range indexes {
		if err := tx.Exec(fmt.Sprintf("CREATE UNIQUE INDEX uidx_%s_code ON %s (%s)", index.table, index.table, index.columns)).Error; err != nil {
			return fmt.Errorf("add %s code index: %w", index.table, err)
		}
	}
	for _, statement := range []string{
		"CREATE UNIQUE INDEX uidx_ipam_scope_cidr ON ipam_subnet (network_scope_id, cidr)",
		"ALTER TABLE ipam_subnet ADD CONSTRAINT uq_ipam_subnet_scope UNIQUE (id, network_scope_id)",
		"ALTER TABLE ipam_ip_address ADD CONSTRAINT fk_ipam_address_subnet_scope FOREIGN KEY (subnet_id, network_scope_id) REFERENCES ipam_subnet (id, network_scope_id) ON DELETE RESTRICT",
		"CREATE INDEX idx_ipam_open_conflicts ON ipam_conflict (address_id) WHERE resolved_at IS NULL AND deleted_at IS NULL",
		"CREATE UNIQUE INDEX uidx_ipam_rack_subnet_usage ON ipam_rack_subnet_binding (rack_id, subnet_id, usage_type)",
		"CREATE UNIQUE INDEX uidx_ipam_rack_usage_default ON ipam_rack_subnet_binding (rack_id, usage_type) WHERE is_default AND status = 1",
		"CREATE UNIQUE INDEX uidx_org_manufacturer_enterprise_oid ON org_manufacturer (enterprise_oid) WHERE enterprise_oid IS NOT NULL",
		"CREATE UNIQUE INDEX uidx_org_vendor_credit_code ON org_vendor (credit_code)",
		"CREATE UNIQUE INDEX uidx_org_contact_vendor_code ON org_contact (vendor_id, code) WHERE vendor_id IS NOT NULL",
		"CREATE UNIQUE INDEX uidx_org_contact_mfr_code ON org_contact (manufacturer_id, code) WHERE manufacturer_id IS NOT NULL",
		"ALTER TABLE org_contact ADD CONSTRAINT ck_org_contact_owner CHECK (num_nonnulls(vendor_id, manufacturer_id) = 1)",
		"ALTER TABLE org_vendor_qualification ADD CONSTRAINT ck_org_qualification_owner CHECK ((kind = 'oem_authorization' AND manufacturer_id IS NOT NULL) OR (kind = 'media_destruction' AND manufacturer_id IS NULL))",
		"ALTER TABLE org_vendor_qualification ADD CONSTRAINT ck_org_qualification_dates CHECK (valid_from <= valid_until)",
		"ALTER TABLE org_contact_certification ADD CONSTRAINT ck_org_certification_dates CHECK (valid_from <= valid_until)",
	} {
		if err := tx.Exec(statement).Error; err != nil {
			return fmt.Errorf("add managed constraints: %w", err)
		}
	}
	return nil
}
