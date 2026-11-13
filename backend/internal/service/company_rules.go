package service

import (
	"context"
	"strings"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

const creditAlphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY"

func CompanyRule(_ context.Context, item, _ *domain.Company) error {
	item.CreditCode = strings.ToUpper(strings.TrimSpace(item.CreditCode))
	if item.CreditCode == "" {
		return nil
	}
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
	return nil
}
