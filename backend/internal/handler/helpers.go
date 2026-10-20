package handler

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/validator"
	"infranexus/internal/domain"
)

func parseIDParam(c fiber.Ctx) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return uuid.Nil, coreerrors.ErrParamInvalid.WithMessage("非法的 UUID 格式")
	}
	return id, nil
}

func bindBody(c fiber.Ctx, req any) error {
	if err := c.Bind().Body(req); err != nil {
		return coreerrors.ErrParamInvalid.WithMessage("请求体格式错误")
	}
	return validator.Validate(req)
}

func currentPrincipal(c fiber.Ctx) (*domain.Principal, error) {
	p, ok := c.Locals("current_principal").(*domain.Principal)
	if !ok || p == nil {
		return nil, coreerrors.ErrUnauthorized
	}
	return p, nil
}

func pageParams(c fiber.Ctx, defaultSize int) (int, int) {
	page, err := strconv.Atoi(c.Query("page", "1"))
	if err != nil || page < 1 {
		page = 1
	}
	size, err := strconv.Atoi(c.Query("page_size", strconv.Itoa(defaultSize)))
	if err != nil || size < 1 {
		size = defaultSize
	}
	if size > 100 {
		size = 100
	}
	return page, size
}
