package bootstrap

import (
	"fmt"

	"gorm.io/gorm"

	"infranexus/internal/domain"
)

const migrationLocationIPAMVendors = "20261109_v05_dcim_foundation"

func migrateLocationIPAMVendors(tx *gorm.DB) error {
	if err := tx.AutoMigrate(
		&legacyDatacenter{}, &legacyBuilding{}, &legacyFloor{}, &legacyRoom{}, &legacyRackRow{}, &legacyRack{},
		&domain.Warehouse{}, &domain.Shelf{}, &domain.Bin{}, &domain.TemporaryLocation{}, &domain.RackUnitAllocation{},
		&domain.NetworkScope{}, &domain.SecurityZone{}, &domain.Subnet{}, &domain.IPAddress{}, &domain.IPConflict{},
		&domain.ManagedAudit{}, &domain.ManagedReceipt{},
	); err != nil {
		return fmt.Errorf("create managed schema: %w", err)
	}
	for _, ref := range domain.LegacyManagedReferences() {
		// All identifiers come from the static domain registry.
		if err := tx.Exec(fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT fk_%s_%s FOREIGN KEY (%s) REFERENCES %s(id) ON DELETE RESTRICT",
			ref.Table, ref.Table, ref.Column, ref.Column, ref.Target)).Error; err != nil {
			return fmt.Errorf("add %s.%s reference: %w", ref.Table, ref.Column, err)
		}
	}
	for _, statement := range []string{
		"CREATE UNIQUE INDEX uidx_ipam_scope_cidr ON ipam_subnet (network_scope_id, cidr)",
		"ALTER TABLE ipam_subnet ADD CONSTRAINT uq_ipam_subnet_scope UNIQUE (id, network_scope_id)",
		"ALTER TABLE ipam_ip_address ADD CONSTRAINT fk_ipam_address_subnet_scope FOREIGN KEY (subnet_id, network_scope_id) REFERENCES ipam_subnet (id, network_scope_id) ON DELETE RESTRICT",
		"CREATE INDEX idx_ipam_open_conflicts ON ipam_conflict (address_id) WHERE resolved_at IS NULL AND deleted_at IS NULL",
	} {
		if err := tx.Exec(statement).Error; err != nil {
			return fmt.Errorf("add managed constraints: %w", err)
		}
	}
	return nil
}
