package handler

import (
	"errors"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func managedError(err error) error {
	switch {
	case errors.Is(err, domain.ErrManagedNotFound):
		return coreerrors.NewDomainError(fiber.StatusNotFound, response.CodeManagedNotFound, "记录不存在")
	case errors.Is(err, domain.ErrEditRevisionConflict):
		return coreerrors.ErrResourceConflict.WithMessage("记录版本已变化，请刷新后重试")
	case errors.Is(err, domain.ErrManagedReference), errors.Is(err, gorm.ErrForeignKeyViolated):
		return coreerrors.ErrResourceConflict.WithMessage("记录仍被引用或有历史依赖，无法执行该操作")
	case errors.Is(err, domain.ErrManagedKeyReuse):
		return coreerrors.ErrResourceConflict.WithMessage("相同幂等键对应不同请求内容")
	default:
		return err
	}
}

func managedQuery(c fiber.Ctx) (domain.ManagedQuery, error) {
	page, size := pageParams(c, 25)
	q := domain.ManagedQuery{Page: page, PageSize: size, Search: strings.TrimSpace(c.Query("search"))}
	if len(q.Search) > 256 {
		return q, coreerrors.ErrParamInvalid.WithMessage("搜索词最多 256 字节")
	}
	if raw := c.Query("status"); raw != "" {
		status, err := strconv.Atoi(raw)
		if err != nil || status != 1 && status != 2 {
			return q, coreerrors.ErrParamInvalid.WithMessage("status 须为 1 或 2")
		}
		q.Status = status
	}
	if raw := c.Query("parent_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil {
			return q, coreerrors.ErrParamInvalid.WithMessage("parent_id 格式无效")
		}
		q.ParentID = &id
	}
	if raw := c.Query("security_zone_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil {
			return q, coreerrors.ErrParamInvalid.WithMessage("security_zone_id 格式无效")
		}
		q.SecurityZoneID = &id
	}
	q.UsageType = strings.TrimSpace(c.Query("usage_type"))
	if len(q.UsageType) > 32 {
		return q, coreerrors.ErrParamInvalid.WithMessage("usage_type 最多 32 字节")
	}
	return q, nil
}

func managedActor(c fiber.Ctx) (uuid.UUID, error) {
	p, err := currentPrincipal(c)
	if err != nil {
		return uuid.Nil, err
	}
	return p.UserID, nil
}

type managedHandler[T any] struct{ service domain.ManagedService[T] }

func RegisterManagedRoutes[T any](router fiber.Router, service domain.ManagedService[T]) {
	h := managedHandler[T]{service: service}
	router.Get("", h.list)
	router.Post("", h.create)
	router.Post("/import/preview", h.importPreview)
	router.Post("/import", h.importCommit)
	router.Get("/export", h.export)
	router.Get("/:id", h.detail)
	router.Get("/:id/history", h.history)
	router.Get("/:id/references", h.references)
	router.Put("/:id", h.update)
	router.Patch("/:id/status", h.status)
	router.Delete("/:id", h.delete)
}

func (h *managedHandler[T]) list(c fiber.Ctx) error {
	q, err := managedQuery(c)
	if err != nil {
		return err
	}
	items, total, err := h.service.List(c.Context(), q)
	if err != nil {
		return managedError(err)
	}
	return response.Page(c, items, total, q.Page, q.PageSize)
}
func (h *managedHandler[T]) detail(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	item, err := h.service.Get(c.Context(), id)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, item)
}
func (h *managedHandler[T]) references(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	items, err := h.service.References(c.Context(), id)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, items)
}
func (h *managedHandler[T]) history(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	q, err := managedQuery(c)
	if err != nil {
		return err
	}
	items, total, err := h.service.History(c.Context(), id, q)
	if err != nil {
		return managedError(err)
	}
	return response.Page(c, items, total, q.Page, q.PageSize)
}
func (h *managedHandler[T]) create(c fiber.Ctx) error {
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	var input T
	if err := c.Bind().JSON(&input); err != nil {
		return coreerrors.ErrParamInvalid.WithMessage("请求体格式错误")
	}
	item, err := h.service.Create(c.Context(), actor, c.Get("Idempotency-Key"), input)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, item)
}
func (h *managedHandler[T]) update(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	var input struct {
		ExpectedVersion int64 `json:"expected_version"`
		Data            *T    `json:"data"`
	}
	if err := c.Bind().JSON(&input); err != nil || input.Data == nil {
		return coreerrors.ErrParamInvalid.WithMessage("需提供 expected_version 与 data")
	}
	item, err := h.service.Update(c.Context(), actor, id, input.ExpectedVersion, *input.Data)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, item)
}
func (h *managedHandler[T]) status(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	var input struct {
		ExpectedVersion int64 `json:"expected_version" validate:"required,gt=0"`
		Status          int   `json:"status" validate:"required,oneof=1 2"`
	}
	if err := bindBody(c, &input); err != nil {
		return err
	}
	item, err := h.service.SetStatus(c.Context(), actor, id, input.ExpectedVersion, input.Status)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, item)
}
func (h *managedHandler[T]) delete(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	version, err := strconv.ParseInt(c.Query("expected_version"), 10, 64)
	if err != nil || version < 1 {
		return coreerrors.ErrParamInvalid.WithMessage("expected_version 必须为正整数")
	}
	if err := h.service.Delete(c.Context(), actor, id, version); err != nil {
		return managedError(err)
	}
	return response.Success(c, struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true})
}
func (h *managedHandler[T]) importPreview(c fiber.Ctx) error { return h.importRows(c, true) }
func (h *managedHandler[T]) importCommit(c fiber.Ctx) error  { return h.importRows(c, false) }
func (h *managedHandler[T]) importRows(c fiber.Ctx, preview bool) error {
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	var input struct {
		Items []T `json:"items"`
	}
	if err := c.Bind().JSON(&input); err != nil {
		return coreerrors.ErrParamInvalid.WithMessage("请求体格式错误")
	}
	result, err := h.service.Import(c.Context(), actor, c.Get("Idempotency-Key"), input.Items, preview)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, result)
}
func (h *managedHandler[T]) export(c fiber.Ctx) error {
	q, err := managedQuery(c)
	if err != nil {
		return err
	}
	items, err := h.service.Export(c.Context(), q)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, items)
}
