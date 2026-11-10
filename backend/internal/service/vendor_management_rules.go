package service

import (
	"context"
	"regexp"
	"slices"
	"strings"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

func ManufacturerRule(_ context.Context, item, _ *domain.Manufacturer) error {
	if item.SerialNumberPattern != "" {
		if _, err := regexp.Compile(item.SerialNumberPattern); err != nil {
			return coreerrors.ErrParamInvalid.WithMessage("序列号正则表达式无效")
		}
	}
	return nil
}

const creditAlphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY"

func VendorRule(contacts domain.ManagedRepository[domain.OrganizationContact]) ManagedRule[domain.Vendor] {
	return func(ctx context.Context, item, old *domain.Vendor) error {
		item.CreditCode = strings.ToUpper(item.CreditCode)
		weights := [17]int{1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28}
		if len(item.CreditCode) != 18 {
			return coreerrors.ErrParamInvalid.WithMessage("统一社会信用代码格式无效")
		}
		var sum int
		for i, weight := range weights {
			index := strings.IndexByte(creditAlphabet, item.CreditCode[i])
			if index < 0 {
				return coreerrors.ErrParamInvalid.WithMessage("统一社会信用代码包含非法字符")
			}
			sum += index * weight
		}
		if item.CreditCode[17] != creditAlphabet[(31-sum%31)%31] {
			return coreerrors.ErrParamInvalid.WithMessage("统一社会信用代码校验位无效")
		}
		if old != nil && old.CooperationStatus == "terminated" && item.CooperationStatus != "terminated" {
			return coreerrors.ErrResourceConflict.WithMessage("已终止合作的供应商须通过新的合作流程恢复")
		}
		if item.PrimaryContactID != nil {
			contact, err := activeManagedParent(ctx, contacts, *item.PrimaryContactID)
			if err != nil {
				return err
			}
			if old == nil || contact.VendorID == nil || *contact.VendorID != old.ID || !slices.Contains(contact.Roles, "account_manager") {
				return coreerrors.ErrParamInvalid.WithMessage("主联系人必须是该供应商的在职客户经理")
			}
		}
		return nil
	}
}

var maskedIdentifier = regexp.MustCompile(`^[[:alnum:]]{0,6}\*{3,}[[:alnum:]]{0,4}$`)

func OrganizationContactRule(uow domain.ManagedUnitOfWork, manufacturers domain.ManagedRepository[domain.Manufacturer], vendors domain.ManagedRepository[domain.Vendor]) ManagedRule[domain.OrganizationContact] {
	return func(ctx context.Context, item, old *domain.OrganizationContact) error {
		if (item.ManufacturerID == nil) == (item.VendorID == nil) {
			return coreerrors.ErrParamInvalid.WithMessage("联系人须且仅能归属一个制造商或供应商")
		}
		if item.MaskedID != "" && (item.IDDocumentType == "" || !maskedIdentifier.MatchString(item.MaskedID)) {
			return coreerrors.ErrParamInvalid.WithMessage("仅接受脱敏证件标识和对应证件类型")
		}
		if old != nil && (!sameManagedID(old.ManufacturerID, item.ManufacturerID) || !sameManagedID(old.VendorID, item.VendorID) || slices.Contains(old.Roles, "account_manager") && !slices.Contains(item.Roles, "account_manager")) {
			if err := requireNoManagedReferences(ctx, uow, old.TableName(), old.ID, false); err != nil {
				return err
			}
		}
		if item.ManufacturerID != nil {
			_, err := activeManagedParent(ctx, manufacturers, *item.ManufacturerID)
			return err
		}
		_, err := activeManagedParent(ctx, vendors, *item.VendorID)
		return err
	}
}

func VendorQualificationRule(vendors domain.ManagedRepository[domain.Vendor], manufacturers domain.ManagedRepository[domain.Manufacturer]) ManagedRule[domain.VendorQualification] {
	return func(ctx context.Context, item, old *domain.VendorQualification) error {
		if old != nil && (item.VendorID != old.VendorID || item.Kind != old.Kind || !sameManagedID(item.ManufacturerID, old.ManufacturerID)) {
			return coreerrors.ErrResourceConflict.WithMessage("已有资质的主体和类型不能变更")
		}
		if item.ValidUntil < item.ValidFrom {
			return coreerrors.ErrParamInvalid.WithMessage("证书有效期结束日期不能早于开始日期")
		}
		if (item.Kind == "oem_authorization") != (item.ManufacturerID != nil) {
			return coreerrors.ErrParamInvalid.WithMessage("原厂授权须关联制造商，销毁资质不关联制造商")
		}
		if _, err := activeManagedParent(ctx, vendors, item.VendorID); err != nil {
			return err
		}
		if item.ManufacturerID != nil {
			_, err := activeManagedParent(ctx, manufacturers, *item.ManufacturerID)
			return err
		}
		return nil
	}
}

func ContactCertificationRule(contacts domain.ManagedRepository[domain.OrganizationContact]) ManagedRule[domain.ContactCertification] {
	return func(ctx context.Context, item, old *domain.ContactCertification) error {
		if old != nil && item.ContactID != old.ContactID {
			return coreerrors.ErrResourceConflict.WithMessage("已有证书的持证人不能变更")
		}
		if item.ValidUntil < item.ValidFrom {
			return coreerrors.ErrParamInvalid.WithMessage("证书有效期结束日期不能早于开始日期")
		}
		_, err := activeManagedParent(ctx, contacts, item.ContactID)
		return err
	}
}
