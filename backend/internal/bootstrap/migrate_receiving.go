package bootstrap

import (
	_ "embed"

	"gorm.io/gorm"

	"infranexus/internal/domain"
)

const migrationReceiving = "20261114_v13_asset_receiving"

//go:embed receiving_schema.sql
var receivingSchema string

func migrateReceiving(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&domain.CatalogModel{},
		&domain.CatalogRevision{},
		&domain.ModelSlot{},
		&domain.ModelPort{},
		&domain.ModelComponent{},
		&domain.ModelCompatibility{},
		&domain.ArrivalOrder{},
		&domain.ArrivalLine{},
		&domain.ArrivalComponent{},
		&domain.Receipt{},
		&domain.ReceiptItem{},
		&domain.ReceiptComponent{},
		&domain.CustodyLocation{},
		&domain.AssetObject{},
		&domain.AssetDevice{},
		&domain.AssetPart{},
		&domain.ReceiptBaseline{},
		&domain.ReceiptBaselineItem{},
		&domain.PartAllocation{},
		&domain.PartPlacement{},
		&domain.AssetAction{},
		&domain.PartMovement{},
		&domain.PartIdentityEvent{},
		&domain.AssetAttachment{},
		&domain.AssetCommandReceipt{}); err != nil {
		return err
	}
	if err := tx.Table("part_model").AutoMigrate(&domain.CatalogModel{}); err != nil {
		return err
	}
	if err := tx.Table("part_model_revision").AutoMigrate(&domain.CatalogRevision{}); err != nil {
		return err
	}
	return tx.Exec(receivingSchema).Error
}
