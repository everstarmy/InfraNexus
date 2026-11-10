package bootstrap

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

type ipamServices struct {
	networkScope      domain.ManagedService[domain.NetworkScope]
	securityZone      domain.ManagedService[domain.SecurityZone]
	subnet            domain.ManagedService[domain.Subnet]
	rackSubnetBinding domain.ManagedService[domain.RackSubnetBinding]
	addresses         domain.AddressPoolService
}

func assembleIPAM(db *gorm.DB, uow domain.ManagedUnitOfWork, datacenterRepo domain.ManagedRepository[domain.Datacenter], rackRepo domain.ManagedRepository[domain.Rack], roomRepo domain.ManagedRepository[domain.Room], securityZoneRepo domain.ManagedRepository[domain.SecurityZone]) ipamServices {
	overlap := repository.NewSubnetOverlapRepository(db)
	networkScopeRepo := repository.NewManagedRepository[domain.NetworkScope](db, "")
	subnetRepo := repository.NewSubnetRepository(db)
	rackSubnetBindingRepo := repository.NewRackSubnetBindingRepository(db)
	return ipamServices{
		networkScope:      service.NewManagedService(networkScopeRepo, uow, nil),
		securityZone:      service.NewManagedService(securityZoneRepo, uow, service.ManagedParentRule(uow, datacenterRepo, func(v *domain.SecurityZone) uuid.UUID { return v.DatacenterID })),
		subnet:            service.NewManagedService(subnetRepo, uow, service.SubnetRule(uow, overlap, networkScopeRepo, securityZoneRepo)),
		rackSubnetBinding: service.NewManagedService(rackSubnetBindingRepo, uow, service.RackSubnetRule(rackRepo, roomRepo, subnetRepo, securityZoneRepo)),
		addresses:         service.NewAddressPoolService(subnetRepo, repository.NewAddressPoolRepository(db), uow),
	}
}
