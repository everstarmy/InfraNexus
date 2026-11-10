package bootstrap

import (
	"gorm.io/gorm"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

type vendorManagementServices struct {
	manufacturer         domain.ManagedService[domain.Manufacturer]
	vendor               domain.ManagedService[domain.Vendor]
	organizationContact  domain.ManagedService[domain.OrganizationContact]
	vendorQualification  domain.ManagedService[domain.VendorQualification]
	contactCertification domain.ManagedService[domain.ContactCertification]
}

func assembleVendorManagement(db *gorm.DB, uow domain.ManagedUnitOfWork) vendorManagementServices {
	manufacturerRepo := repository.NewManagedRepository[domain.Manufacturer](db, "")
	vendorRepo := repository.NewManagedRepository[domain.Vendor](db, "")
	organizationContactRepo := repository.NewOrganizationContactRepository(db)
	vendorQualificationRepo := repository.NewManagedRepository[domain.VendorQualification](db, "vendor_id")
	contactCertificationRepo := repository.NewManagedRepository[domain.ContactCertification](db, "contact_id")
	return vendorManagementServices{
		manufacturer:         service.NewManagedService(manufacturerRepo, uow, service.ManufacturerRule),
		vendor:               service.NewManagedService(vendorRepo, uow, service.VendorRule(organizationContactRepo)),
		organizationContact:  service.NewManagedService(organizationContactRepo, uow, service.OrganizationContactRule(uow, manufacturerRepo, vendorRepo)),
		vendorQualification:  service.NewManagedService(vendorQualificationRepo, uow, service.VendorQualificationRule(vendorRepo, manufacturerRepo)),
		contactCertification: service.NewManagedService(contactCertificationRepo, uow, service.ContactCertificationRule(organizationContactRepo)),
	}
}
