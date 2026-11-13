package repository

import (
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

func NewCompanyRepository(db *gorm.DB) domain.ManagedRepository[domain.Company] {
	repo := newManagedRepository[domain.Company](db, "")
	repo.filter = func(query *gorm.DB, filters domain.ManagedQuery) *gorm.DB {
		switch filters.CompanyType {
		case domain.CompanyManufacturer, domain.CompanySupplier:
			return query.Where("type IN ?", []int{filters.CompanyType, domain.CompanyBoth})
		case domain.CompanyBoth:
			return query.Where("type = ?", domain.CompanyBoth)
		default:
			return query
		}
	}
	return repo
}
