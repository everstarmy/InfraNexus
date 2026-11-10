package domain

import (
	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type Manufacturer struct {
	ManagedBase
	EnglishName         string                      `gorm:"column:english_name;size:128" json:"english_name" validate:"max=128"`
	LogoURL             string                      `gorm:"column:logo_url;size:512" json:"logo_url" validate:"omitempty,http_url,max=512"`
	Website             string                      `gorm:"column:website;size:512" json:"website" validate:"omitempty,http_url,max=512"`
	SupportURL          string                      `gorm:"column:support_url;size:512" json:"support_url" validate:"omitempty,http_url,max=512"`
	SupportPhone        string                      `gorm:"column:support_phone;size:64" json:"support_phone" validate:"max=64"`
	EnterpriseOID       *int64                      `gorm:"column:enterprise_oid;check:enterprise_oid BETWEEN 1 AND 4294967295" json:"enterprise_oid" validate:"omitempty,min=1,max=4294967295"`
	Protocols           datatypes.JSONSlice[string] `gorm:"column:protocols;type:jsonb" json:"protocols" validate:"max=4,unique,dive,oneof=redfish rest snmpv2c snmpv3"`
	SerialNumberPattern string                      `gorm:"column:serial_number_pattern;size:512" json:"serial_number_pattern" validate:"max=512"`
}

func (Manufacturer) TableName() string { return "org_manufacturer" }

type Vendor struct {
	ManagedBase
	PrimaryContactID         *uuid.UUID                  `gorm:"column:primary_contact_id;type:uuid;index" json:"primary_contact_id" validate:"omitempty"`
	CreditCode               string                      `gorm:"column:credit_code;size:18;not null" json:"credit_code" validate:"required,len=18"`
	ShortName                string                      `gorm:"column:short_name;size:128" json:"short_name" validate:"max=128"`
	ServiceTypes             datatypes.JSONSlice[string] `gorm:"column:service_types;type:jsonb;not null" json:"service_types" validate:"required,min=1,max=5,unique,dive,oneof=hardware_supplier oem_service third_party_maintenance spare_parts data_destruction"`
	CooperationStatus        string                      `gorm:"column:cooperation_status;size:24;not null" json:"cooperation_status" validate:"required,oneof=active suspended terminated"`
	EmergencyPhone           string                      `gorm:"column:emergency_phone;size:64" json:"emergency_phone" validate:"max=64"`
	DispatchEmail            string                      `gorm:"column:dispatch_email;size:128" json:"dispatch_email" validate:"omitempty,email,max=128"`
	DispatchURL              string                      `gorm:"column:dispatch_url;size:512" json:"dispatch_url" validate:"omitempty,http_url,max=512"`
	EmergencyResponseMinutes int                         `gorm:"column:emergency_response_minutes;not null" json:"emergency_response_minutes" validate:"min=0,max=525600"`
	PartsResponseMinutes     int                         `gorm:"column:parts_response_minutes;not null" json:"parts_response_minutes" validate:"min=0,max=525600"`
	EngineerResponseMinutes  int                         `gorm:"column:engineer_response_minutes;not null" json:"engineer_response_minutes" validate:"min=0,max=525600"`
}

func (Vendor) TableName() string { return "org_vendor" }

type OrganizationContact struct {
	ManagedBase
	ManufacturerID   *uuid.UUID                  `gorm:"column:manufacturer_id;type:uuid;index" json:"manufacturer_id" validate:"omitempty"`
	VendorID         *uuid.UUID                  `gorm:"column:vendor_id;type:uuid;index" json:"vendor_id" validate:"omitempty"`
	Roles            datatypes.JSONSlice[string] `gorm:"column:roles;type:jsonb;not null" json:"roles" validate:"required,min=1,max=5,unique,dive,oneof=account_manager resident_engineer onsite_engineer escalation_lead commercial_contact"`
	Phone            string                      `gorm:"column:phone;size:64" json:"phone" validate:"max=64"`
	Email            string                      `gorm:"column:email;size:128" json:"email" validate:"omitempty,email,max=128"`
	Title            string                      `gorm:"column:title;size:128" json:"title" validate:"max=128"`
	IDDocumentType   string                      `gorm:"column:id_document_type;size:32" json:"id_document_type" validate:"max=32"`
	MaskedID         string                      `gorm:"column:masked_id;size:32" json:"masked_id" validate:"max=32"`
	AccessRequestRef string                      `gorm:"column:access_request_ref;size:128" json:"access_request_ref" validate:"max=128"`
}

func (OrganizationContact) TableName() string { return "org_contact" }

type VendorQualification struct {
	ManagedBase
	VendorID        uuid.UUID  `gorm:"column:vendor_id;type:uuid;not null;index" json:"vendor_id" validate:"required"`
	ManufacturerID  *uuid.UUID `gorm:"column:manufacturer_id;type:uuid;index" json:"manufacturer_id" validate:"omitempty"`
	Kind            string     `gorm:"column:kind;size:32;not null" json:"kind" validate:"required,oneof=oem_authorization media_destruction"`
	CertificateType string     `gorm:"column:certificate_type;size:64;not null" json:"certificate_type" validate:"required,max=64"`
	CertificateNo   string     `gorm:"column:certificate_no;size:128;not null" json:"certificate_no" validate:"required,max=128"`
	Level           string     `gorm:"column:level;size:64" json:"level" validate:"max=64"`
	ValidFrom       string     `gorm:"column:valid_from;size:10;not null" json:"valid_from" validate:"required,datetime=2006-01-02"`
	ValidUntil      string     `gorm:"column:valid_until;size:10;not null" json:"valid_until" validate:"required,datetime=2006-01-02"`
	EvidenceRef     string     `gorm:"column:evidence_ref;size:256;not null" json:"evidence_ref" validate:"required,max=256"`
}

func (VendorQualification) TableName() string { return "org_vendor_qualification" }

type ContactCertification struct {
	ManagedBase
	ContactID     uuid.UUID `gorm:"column:contact_id;type:uuid;not null;index" json:"contact_id" validate:"required"`
	Issuer        string    `gorm:"column:issuer;size:128;not null" json:"issuer" validate:"required,max=128"`
	CertificateNo string    `gorm:"column:certificate_no;size:128;not null" json:"certificate_no" validate:"required,max=128"`
	ValidFrom     string    `gorm:"column:valid_from;size:10;not null" json:"valid_from" validate:"required,datetime=2006-01-02"`
	ValidUntil    string    `gorm:"column:valid_until;size:10;not null" json:"valid_until" validate:"required,datetime=2006-01-02"`
	EvidenceRef   string    `gorm:"column:evidence_ref;size:256" json:"evidence_ref" validate:"max=256"`
}

func (ContactCertification) TableName() string { return "org_contact_certification" }

func (v VendorQualification) QualificationSnapshot() QualificationAuditSnapshot {
	return QualificationAuditSnapshot{
		CertificateType: v.CertificateType, CertificateNo: v.CertificateNo, Level: v.Level,
		ValidFrom: v.ValidFrom, ValidUntil: v.ValidUntil, EvidenceRef: v.EvidenceRef,
	}
}
func (c ContactCertification) QualificationSnapshot() QualificationAuditSnapshot {
	return QualificationAuditSnapshot{
		CertificateNo: c.CertificateNo, Issuer: c.Issuer,
		ValidFrom: c.ValidFrom, ValidUntil: c.ValidUntil, EvidenceRef: c.EvidenceRef,
	}
}
