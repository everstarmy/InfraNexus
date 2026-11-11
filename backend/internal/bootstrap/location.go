package bootstrap

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

type locationServices struct {
	nodes             domain.LocationTreeService
	warehouse         domain.ManagedService[domain.Warehouse]
	shelf             domain.ManagedService[domain.Shelf]
	bin               domain.ManagedService[domain.Bin]
	temporaryLocation domain.ManagedService[domain.TemporaryLocation]
}

func assembleLocation(db *gorm.DB, uow domain.ManagedUnitOfWork, users domain.UserRepository, nodes domain.LocationNodeRepository) locationServices {
	inventory := repository.NewLocationInventoryRepository(db)
	warehouseRepo := repository.NewManagedRepository[domain.Warehouse](db, "datacenter_id")
	shelfRepo := repository.NewManagedRepository[domain.Shelf](db, "warehouse_id")
	binRepo := repository.NewManagedRepository[domain.Bin](db, "shelf_id")
	temporaryLocationRepo := repository.NewManagedRepository[domain.TemporaryLocation](db, "datacenter_id")
	return locationServices{
		nodes:             service.NewLocationTreeService(nodes, inventory, uow),
		warehouse:         service.NewManagedService(warehouseRepo, uow, service.LocationDatacenterRule(nodes, uow, func(v *domain.Warehouse) uuid.UUID { return v.DatacenterID })),
		shelf:             service.NewManagedService(shelfRepo, uow, service.ShelfRule(uow, inventory, warehouseRepo)),
		bin:               service.NewManagedService(binRepo, uow, service.BinRule(shelfRepo)),
		temporaryLocation: service.NewManagedService(temporaryLocationRepo, uow, service.TemporaryLocationRule(nodes, uow, users)),
	}
}
