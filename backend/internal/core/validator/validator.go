package validator

import (
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strings"

	"github.com/go-playground/validator/v10"

	coreerrors "infranexus/internal/core/errors"
)

type StructValidator struct {
	validate *validator.Validate
}

func New() *StructValidator {
	return &StructValidator{
		validate: validator.New(),
	}
}

func (v *StructValidator) Validate(out any) error {
	return v.validate.Struct(out)
}

type FieldError struct {
	Field   string `json:"field"`
	Tag     string `json:"tag"`
	Message string `json:"message"`
}

var slugPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.:-]*$`)

var shared = newShared()

func newShared() *validator.Validate {
	v := validator.New()
	v.RegisterTagNameFunc(func(f reflect.StructField) string {
		name := strings.SplitN(f.Tag.Get("json"), ",", 2)[0]
		if name == "-" {
			return ""
		}
		if name == "" {
			return f.Name
		}
		return name
	})
	_ = v.RegisterValidation("slug", func(fl validator.FieldLevel) bool {
		return slugPattern.MatchString(fl.Field().String())
	})
	return v
}

func Validate(req any) error {
	err := shared.Struct(req)
	if err == nil {
		return nil
	}
	var verrs validator.ValidationErrors
	if !errors.As(err, &verrs) {
		return coreerrors.ErrParamInvalid
	}
	fields := make([]FieldError, 0, len(verrs))
	for _, e := range verrs {
		fields = append(fields, FieldError{
			Field:   e.Field(),
			Tag:     e.Tag(),
			Message: fmt.Sprintf("字段 %s 校验未通过 (%s)", e.Field(), e.Tag()),
		})
	}
	return coreerrors.ErrParamInvalid.WithData(fields)
}
