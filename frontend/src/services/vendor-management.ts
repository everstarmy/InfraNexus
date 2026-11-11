import { createManagedClient, type ManagedBase } from "./managed"

export type ProtocolType = "redfish" | "rest" | "snmpv2c" | "snmpv3"

export interface ManufacturerDTO extends ManagedBase {
  english_name?: string
  logo_url?: string
  website?: string
  support_url?: string
  support_phone?: string
  enterprise_oid?: number
  protocols?: ProtocolType[]
  serial_number_pattern?: string
}

export type VendorServiceType =
  | "hardware_supplier"
  | "oem_service"
  | "third_party_maintenance"
  | "spare_parts"
  | "data_destruction"

export type CooperationStatus = "active" | "suspended" | "terminated"

export interface VendorDTO extends ManagedBase {
  primary_contact_id?: string | null
  credit_code: string
  short_name?: string
  service_types: VendorServiceType[]
  cooperation_status: CooperationStatus
  emergency_phone?: string
  dispatch_email?: string
  dispatch_url?: string
  emergency_response_minutes?: number
  parts_response_minutes?: number
  engineer_response_minutes?: number
}

export type ContactRole =
  | "account_manager"
  | "resident_engineer"
  | "onsite_engineer"
  | "escalation_lead"
  | "commercial_contact"

export interface OrganizationContactDTO extends ManagedBase {
  manufacturer_id?: string | null
  vendor_id?: string | null
  roles: ContactRole[]
  phone?: string
  email?: string
  title?: string
  id_document_type?: string
  masked_id?: string
  access_request_ref?: string
}

export type QualificationKind = "oem_authorization" | "media_destruction"

export interface VendorQualificationDTO extends ManagedBase {
  vendor_id: string
  manufacturer_id?: string | null
  kind: QualificationKind
  certificate_type: string
  certificate_no: string
  level?: string
  valid_from: string
  valid_until: string
  evidence_ref: string
}

export interface ContactCertificationDTO extends ManagedBase {
  contact_id: string
  issuer: string
  certificate_no: string
  valid_from: string
  valid_until: string
  evidence_ref?: string
}

export const manufacturersService = createManagedClient<ManufacturerDTO>(
  "/vendor-management/manufacturers"
)

export const vendorsService = createManagedClient<VendorDTO>(
  "/vendor-management/vendors"
)

export const contactsService = createManagedClient<OrganizationContactDTO>(
  "/vendor-management/contacts"
)

export const qualificationsService = createManagedClient<VendorQualificationDTO>(
  "/vendor-management/qualifications"
)

export const certificationsService = createManagedClient<ContactCertificationDTO>(
  "/vendor-management/contact-certifications"
)
