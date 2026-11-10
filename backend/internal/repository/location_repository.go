package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type locationInventoryRepository struct {
	*BaseRepository[domain.RackUnitAllocation, uuid.UUID]
}

func NewLocationInventoryRepository(db *gorm.DB) domain.LocationInventoryRepository {
	return &locationInventoryRepository{BaseRepository: NewBaseRepository[domain.RackUnitAllocation, uuid.UUID](db)}
}
func (r *locationInventoryRepository) RackUnits(ctx context.Context, id uuid.UUID) ([]domain.RackUnitAllocation, error) {
	var rows []domain.RackUnitAllocation
	err := r.DB(ctx).Where("rack_id = ?", id).Order("unit DESC").Find(&rows).Error
	return rows, err
}

func (r *locationInventoryRepository) MaxBinLayer(ctx context.Context, id uuid.UUID) (int, error) {
	var layer int
	err := r.DB(ctx).Model(&domain.Bin{}).Where("shelf_id = ?", id).Select("COALESCE(MAX(layer), 0)").Scan(&layer).Error
	return layer, err
}
