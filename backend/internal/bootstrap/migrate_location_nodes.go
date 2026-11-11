package bootstrap

import (
	_ "embed"
	"fmt"

	"gorm.io/gorm"
)

const migrationLocationNodes = "20261111_v07_location_node_schema"

//go:embed location_node_schema.sql
var locationNodeSchema string

func migrateLocationNodes(tx *gorm.DB) error {
	if err := tx.Exec(locationNodeSchema).Error; err != nil {
		return fmt.Errorf("create location node schema: %w", err)
	}
	return nil
}
