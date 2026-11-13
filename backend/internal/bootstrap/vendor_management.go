package bootstrap

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

type vendorManagementServices struct {
	companies domain.ManagedService[domain.Company]
	contacts  domain.ManagedService[domain.CompanyContact]
}

func assembleVendorManagement(db *gorm.DB, uow domain.ManagedUnitOfWork) vendorManagementServices {
	companies := repository.NewCompanyRepository(db)
	contacts := repository.NewManagedRepository[domain.CompanyContact](db, "company_id")
	return vendorManagementServices{
		companies: service.NewManagedService(companies, uow, service.CompanyRule),
		contacts: service.NewManagedService(contacts, uow, service.ManagedParentRule(uow, companies, func(contact *domain.CompanyContact) uuid.UUID {
			return contact.CompanyID
		})),
	}
}
