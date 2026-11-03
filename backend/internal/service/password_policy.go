package service

import (
	"unicode"
	"unicode/utf8"

	coreerrors "infranexus/internal/core/errors"
)

const minPasswordLength = 8

func CheckPasswordStrength(password string) error {
	if utf8.RuneCountInString(password) < minPasswordLength {
		return coreerrors.ErrPasswordTooWeak
	}
	var upper, lower, digit, symbol bool
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsLower(r):
			lower = true
		case unicode.IsDigit(r):
			digit = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			symbol = true
		}
	}
	classes := 0
	for _, ok := range []bool{upper, lower, digit, symbol} {
		if ok {
			classes++
		}
	}
	if classes < 3 {
		return coreerrors.ErrPasswordTooWeak
	}
	return nil
}
