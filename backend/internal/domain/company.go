package domain

import "github.com/google/uuid"

const (
	CompanyManufacturer = 1
	CompanySupplier     = 2
	CompanyBoth         = 3
)

type Company struct {
	ManagedBase
	Type        int    `gorm:"not null;check:type IN (1,2,3)" json:"type" validate:"required,oneof=1 2 3"`
	EnglishName string `gorm:"size:128" json:"english_name" validate:"max=128"`
	ShortName   string `gorm:"size:128" json:"short_name" validate:"max=128"`
	Website     string `gorm:"size:512" json:"website" validate:"omitempty,http_url,max=512"`
	CreditCode  string `gorm:"size:18" json:"credit_code" validate:"omitempty,len=18"`
}

func (Company) TableName() string { return "org_company" }

type CompanyContact struct {
	ManagedBase
	CompanyID uuid.UUID `gorm:"type:uuid;not null" json:"company_id" validate:"required"`
	Phone     string    `gorm:"size:64" json:"phone" validate:"max=64"`
	Email     string    `gorm:"size:128" json:"email" validate:"omitempty,email,max=128"`
	Title     string    `gorm:"size:128" json:"title" validate:"max=128"`
}

func (CompanyContact) TableName() string { return "org_company_contact" }
