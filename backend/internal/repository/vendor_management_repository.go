package repository

import (
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

func NewOrganizationContactRepository(db *gorm.DB) domain.ManagedRepository[domain.OrganizationContact] {
	repo := newManagedRepository[domain.OrganizationContact](db, "")
	repo.filter = func(query *gorm.DB, filters domain.ManagedQuery) *gorm.DB {
		if filters.ParentID == nil {
			return query
		}
		return query.Where("(manufacturer_id = ? OR vendor_id = ?)", *filters.ParentID, *filters.ParentID)
	}
	return repo
}
