package handler

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type addressPoolHandler struct{ service domain.AddressPoolService }

func RegisterAddressPoolRoutes(router fiber.Router, service domain.AddressPoolService) {
	h := addressPoolHandler{service: service}
	router.Get("/:id/addresses", h.list)
	router.Get("/:id/addresses/:address", h.detail)
	router.Patch("/:id/addresses/:address/reservation", h.reserve)
	router.Get("/:id/addresses/:address/history", h.history)
	router.Get("/:id/addresses/:address/conflicts", h.conflicts)
	router.Post("/:id/addresses/:address/conflicts", h.report)
	router.Patch("/:id/addresses/:address/conflicts/:conflictID/resolve", h.resolve)
}
func (h *addressPoolHandler) list(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	_, size := pageParams(c, 64)
	page, err := strconv.Atoi(c.Query("page", "1"))
	if err != nil || page < 1 || int64(page) > 1<<32 {
		return coreerrors.ErrParamInvalid.WithMessage("地址池页码超出范围")
	}
	items, total, err := h.service.List(c.Context(), id, domain.ManagedQuery{Page: page, PageSize: size})
	if err != nil {
		return managedError(err)
	}
	return response.Page(c, items, total, page, size)
}
func (h *addressPoolHandler) detail(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	item, err := h.service.Detail(c.Context(), id, c.Params("address"))
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, item)
}
func (h *addressPoolHandler) reserve(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	var req domain.IPAddressReservationRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	item, err := h.service.Reserve(c.Context(), actor, id, c.Params("address"), req)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, item)
}
func (h *addressPoolHandler) history(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	page, size := pageParams(c, 25)
	items, total, err := h.service.History(c.Context(), id, c.Params("address"), domain.ManagedQuery{Page: page, PageSize: size})
	if err != nil {
		return managedError(err)
	}
	return response.Page(c, items, total, page, size)
}
func (h *addressPoolHandler) conflicts(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	page, size := pageParams(c, 25)
	items, total, err := h.service.Conflicts(c.Context(), id, c.Params("address"), domain.ManagedQuery{Page: page, PageSize: size})
	if err != nil {
		return managedError(err)
	}
	return response.Page(c, items, total, page, size)
}
func (h *addressPoolHandler) report(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	var req domain.IPConflictRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	item, err := h.service.ReportConflict(c.Context(), actor, id, c.Params("address"), c.Get("Idempotency-Key"), req)
	if err != nil {
		return managedError(err)
	}
	return response.Success(c, item)
}
func (h *addressPoolHandler) resolve(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	conflict, err := uuid.Parse(c.Params("conflictID"))
	if err != nil {
		return coreerrors.ErrParamInvalid.WithMessage("冲突记录 UUID 无效")
	}
	actor, err := managedActor(c)
	if err != nil {
		return err
	}
	var req domain.IPConflictResolution
	if err := bindBody(c, &req); err != nil {
		return err
	}
	if err := h.service.ResolveConflict(c.Context(), actor, id, conflict, c.Params("address"), req); err != nil {
		return managedError(err)
	}
	return response.Success(c, struct {
		Resolved bool `json:"resolved"`
	}{Resolved: true})
}
