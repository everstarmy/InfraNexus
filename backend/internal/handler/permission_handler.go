package handler

import (
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type PermissionHandler struct {
	permSvc domain.PermissionService
}

func NewPermissionHandler(permSvc domain.PermissionService) *PermissionHandler {
	return &PermissionHandler{permSvc: permSvc}
}

func (h *PermissionHandler) Tree(c fiber.Ctx) error {
	tree, err := h.permSvc.Tree(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, tree)
}

func (h *PermissionHandler) Create(c fiber.Ctx) error {
	var req domain.PermissionRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	perm, err := h.permSvc.Create(c.Context(), req)
	if err != nil {
		return err
	}
	return response.Success(c, perm)
}

func (h *PermissionHandler) Update(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	var req domain.PermissionRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	perm, err := h.permSvc.Update(c.Context(), id, req)
	if err != nil {
		return err
	}
	return response.Success(c, perm)
}

func (h *PermissionHandler) Delete(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	if err := h.permSvc.Delete(c.Context(), id); err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"deleted": true})
}

func (h *PermissionHandler) Sync(c fiber.Ctx) error {
	report, err := h.permSvc.SyncRoutes(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, report)
}
