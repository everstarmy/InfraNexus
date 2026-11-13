import { createManagedClient, type ManagedBase } from "./managed"

export type CompanyType = 1 | 2 | 3

export interface CompanyDTO extends ManagedBase {
  type: CompanyType
  english_name?: string
  short_name?: string
  website?: string
  credit_code?: string
}

export interface CompanyContactDTO extends ManagedBase {
  company_id: string
  phone?: string
  email?: string
  title?: string
}

export const companiesService = createManagedClient<CompanyDTO>("/vendor-management/companies")
export const companyContactsService = createManagedClient<CompanyContactDTO>("/vendor-management/company-contacts")
