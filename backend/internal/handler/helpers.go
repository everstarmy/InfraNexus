package handler

import (
	"strconv"
	"strings"

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

const maxPage = 1_000_000

func pageParams(c fiber.Ctx, defaultSize int) (int, int) {
	page, err := strconv.Atoi(c.Query("page", "1"))
	if err != nil || page < 1 {
		page = 1
	}
	// Keep (page-1)*size far from integer overflow, which would otherwise turn
	// into a negative offset and silently return the first page.
	if page > maxPage {
		page = maxPage
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

func queryStrings(c fiber.Ctx, key string) []string {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return nil
	}
	out := make([]string, 0)
	for _, part := range strings.Split(raw, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func queryInts(c fiber.Ctx, key string) []int {
	out := make([]int, 0)
	for _, part := range queryStrings(c, key) {
		if n, err := strconv.Atoi(part); err == nil {
			out = append(out, n)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func queryUUIDs(c fiber.Ctx, key string) []uuid.UUID {
	out := make([]uuid.UUID, 0)
	for _, part := range queryStrings(c, key) {
		if id, err := uuid.Parse(part); err == nil {
			out = append(out, id)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
