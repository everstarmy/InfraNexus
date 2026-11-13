package bootstrap

import (
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

const migrationCompanyProfiles = "20261113_v12_company_profiles"

func migrateCompanyProfiles(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&domain.Company{}, &domain.CompanyContact{}); err != nil {
		return err
	}
	return tx.Exec(`
ALTER TABLE org_company_contact ADD CONSTRAINT fk_org_company_contact_company_id
    FOREIGN KEY (company_id) REFERENCES org_company(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uidx_org_company_credit_code ON org_company(credit_code)
    WHERE credit_code <> '';
CREATE INDEX idx_org_company_contact_company_id ON org_company_contact(company_id);
`).Error
}
