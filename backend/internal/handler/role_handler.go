package handler

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type RoleHandler struct {
	roleSvc domain.RoleService
}

func NewRoleHandler(roleSvc domain.RoleService) *RoleHandler {
	return &RoleHandler{roleSvc: roleSvc}
}

func (h *RoleHandler) List(c fiber.Ctx) error {
	page, pageSize := pageParams(c, 50)

	roles, total, err := h.roleSvc.ListRoles(c.Context(), strings.TrimSpace(c.Query("keyword")), page, pageSize)
	if err != nil {
		return err
	}

	return response.Page(c, roles, total, page, pageSize)
}

func (h *RoleHandler) GetByID(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}

	role, err := h.roleSvc.GetRole(c.Context(), id)
	if err != nil {
		return err
	}

	return response.Success(c, role)
}

func (h *RoleHandler) Create(c fiber.Ctx) error {
	var req domain.CreateRoleRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}

	role, err := h.roleSvc.CreateRole(c.Context(), req)
	if err != nil {
		return err
	}

	return response.Success(c, role)
}

func (h *RoleHandler) Update(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}

	var req domain.UpdateRoleRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}

	role, err := h.roleSvc.UpdateRole(c.Context(), id, req)
	if err != nil {
		return err
	}

	return response.Success(c, role)
}

func (h *RoleHandler) Delete(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}

	if err := h.roleSvc.DeleteRole(c.Context(), id); err != nil {
		return err
	}

	return response.Success(c, fiber.Map{"deleted": true})
}

type AssignPermissionsRequest struct {
	PermissionIDs []uuid.UUID `json:"permission_ids"`
}

func (h *RoleHandler) AssignPermissions(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}

	var req AssignPermissionsRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}

	if err := h.roleSvc.AssignPermissions(c.Context(), id, req.PermissionIDs); err != nil {
		return err
	}

	return response.Success(c, fiber.Map{"assigned": true})
}
