package bootstrap

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

type locationServices struct {
	datacenter        domain.ManagedService[domain.Datacenter]
	building          domain.ManagedService[domain.Building]
	floor             domain.ManagedService[domain.Floor]
	room              domain.ManagedService[domain.Room]
	rackRow           domain.ManagedService[domain.RackRow]
	rack              domain.ManagedService[domain.Rack]
	warehouse         domain.ManagedService[domain.Warehouse]
	shelf             domain.ManagedService[domain.Shelf]
	bin               domain.ManagedService[domain.Bin]
	temporaryLocation domain.ManagedService[domain.TemporaryLocation]
	rackUnits         domain.RackInventoryService
}

func assembleLocation(db *gorm.DB, uow domain.ManagedUnitOfWork, users domain.UserRepository, datacenterRepo domain.ManagedRepository[domain.Datacenter], rackRepo domain.ManagedRepository[domain.Rack], roomRepo domain.ManagedRepository[domain.Room], securityZoneRepo domain.ManagedRepository[domain.SecurityZone]) locationServices {
	inventory := repository.NewLocationInventoryRepository(db)
	buildingRepo := repository.NewManagedRepository[domain.Building](db, "datacenter_id")
	floorRepo := repository.NewManagedRepository[domain.Floor](db, "building_id")
	rackRowRepo := repository.NewManagedRepository[domain.RackRow](db, "room_id")
	warehouseRepo := repository.NewManagedRepository[domain.Warehouse](db, "datacenter_id")
	shelfRepo := repository.NewManagedRepository[domain.Shelf](db, "warehouse_id")
	binRepo := repository.NewManagedRepository[domain.Bin](db, "shelf_id")
	temporaryLocationRepo := repository.NewManagedRepository[domain.TemporaryLocation](db, "datacenter_id")
	return locationServices{
		datacenter:        service.NewManagedService(datacenterRepo, uow, service.DatacenterRule(users)),
		building:          service.NewManagedService(buildingRepo, uow, service.ManagedParentRule(uow, datacenterRepo, func(v *domain.Building) uuid.UUID { return v.DatacenterID })),
		floor:             service.NewManagedService(floorRepo, uow, service.ManagedParentRule(uow, buildingRepo, func(v *domain.Floor) uuid.UUID { return v.BuildingID })),
		room:              service.NewManagedService(roomRepo, uow, service.RoomRule(uow, floorRepo, buildingRepo)),
		rackRow:           service.NewManagedService(rackRowRepo, uow, service.ManagedParentRule(uow, roomRepo, func(v *domain.RackRow) uuid.UUID { return v.RoomID })),
		rack:              service.NewManagedService(rackRepo, uow, service.RackRule(uow, inventory, rackRowRepo, roomRepo, securityZoneRepo)),
		warehouse:         service.NewManagedService(warehouseRepo, uow, service.ManagedParentRule(uow, datacenterRepo, func(v *domain.Warehouse) uuid.UUID { return v.DatacenterID })),
		shelf:             service.NewManagedService(shelfRepo, uow, service.ShelfRule(uow, inventory, warehouseRepo)),
		bin:               service.NewManagedService(binRepo, uow, service.BinRule(shelfRepo)),
		temporaryLocation: service.NewManagedService(temporaryLocationRepo, uow, service.TemporaryLocationRule(uow, datacenterRepo, users)),
		rackUnits:         service.NewRackInventoryService(rackRepo, inventory),
	}
}
