package service

import (
	"github.com/google/uuid"

	"infranexus/internal/domain"
)

func rackUnitView(id uuid.UUID, height, status int, occupied []domain.RackUnitAllocation) domain.RackUnitView {
	out := domain.RackUnitView{RackID: id}
	byUnit := make(map[int]domain.RackUnitAllocation, len(occupied))
	for _, row := range occupied {
		byUnit[row.Unit] = row
	}
	out.Units = make([]domain.RackUnit, 0, height)
	for u := height; u > 0; u-- {
		unit := domain.RackUnit{Unit: u, State: "free", Available: status == domain.StatusEnabled}
		if row, ok := byUnit[u]; ok {
			unit.State, unit.SubjectID, unit.Available = row.State, &row.SubjectID, false
		}
		out.Units = append(out.Units, unit)
	}
	return out
}
