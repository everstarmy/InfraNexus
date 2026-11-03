package service

import (
	"errors"
	"testing"

	coreerrors "infranexus/internal/core/errors"
)

func TestCheckPasswordStrengthRequiresLengthAndThreeClasses(t *testing.T) {
	weak := []string{"", "Ab1!", "abcdefgh", "abcdefg1", "ABCDEFGH1", "12345678", "admin123456"}
	for _, pw := range weak {
		if err := CheckPasswordStrength(pw); !errors.Is(err, coreerrors.ErrPasswordTooWeak) {
			t.Fatalf("%q accepted: %v", pw, err)
		}
	}
	strong := []string{"Abcdefg1", "abcdef1!", "ABCDEF1!", "Str0ng!pass", "密码Abc12345"}
	for _, pw := range strong {
		if err := CheckPasswordStrength(pw); err != nil {
			t.Fatalf("%q rejected: %v", pw, err)
		}
	}
}
