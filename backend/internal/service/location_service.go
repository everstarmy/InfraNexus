package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type rackInventoryService struct {
	racks     domain.ManagedRepository[domain.Rack]
	inventory domain.LocationInventoryRepository
}

func NewRackInventoryService(racks domain.ManagedRepository[domain.Rack], inventory domain.LocationInventoryRepository) domain.RackInventoryService {
	return &rackInventoryService{racks: racks, inventory: inventory}
}
func (s *rackInventoryService) Units(ctx context.Context, id uuid.UUID) (domain.RackUnitView, error) {
	out := domain.RackUnitView{RackID: id}
	rack, err := s.racks.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return out, domain.ErrManagedNotFound
	}
	if err != nil {
		return out, err
	}
	occupied, err := s.inventory.RackUnits(ctx, id)
	if err != nil {
		return out, err
	}
	byUnit := make(map[int]domain.RackUnitAllocation, len(occupied))
	for _, row := range occupied {
		byUnit[row.Unit] = row
	}
	out.Units = make([]domain.RackUnit, 0, rack.Units)
	for u := rack.Units; u > 0; u-- {
		unit := domain.RackUnit{Unit: u, State: "free", Available: rack.Status == domain.StatusEnabled}
		if row, ok := byUnit[u]; ok {
			unit.State, unit.SubjectID, unit.Available = row.State, &row.SubjectID, false
		}
		out.Units = append(out.Units, unit)
	}
	return out, nil
}
