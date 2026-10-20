package validator

import (
	"fmt"
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
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

// ValidateRequest 业务层统一便捷校验工具函数
func ValidateRequest(c fiber.Ctx, req any) error {
	v := validator.New()
	err := v.Struct(req)
	if err == nil {
		return nil
	}

	var fieldErrors []FieldError
	if validationErrors, ok := err.(validator.ValidationErrors); ok {
		for _, e := range validationErrors {
			fieldErrors = append(fieldErrors, FieldError{
				Field:   strings.ToLower(e.Field()),
				Tag:     e.Tag(),
				Message: fmt.Sprintf("字段 %s 校验未通过 (%s)", e.Field(), e.Tag()),
			})
		}
	}

	return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "请求参数校验失败", fieldErrors)
}
