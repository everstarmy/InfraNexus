package handler

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type RoleHandler struct {
	roleSvc  domain.RoleService
	roleRepo domain.RoleRepository
	permRepo domain.PermissionRepository
}

func NewRoleHandler(roleSvc domain.RoleService, roleRepo domain.RoleRepository, permRepo domain.PermissionRepository) *RoleHandler {
	return &RoleHandler{
		roleSvc:  roleSvc,
		roleRepo: roleRepo,
		permRepo: permRepo,
	}
}

func (h *RoleHandler) List(c fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	pageSize, _ := strconv.Atoi(c.Query("page_size", "50"))

	roles, total, err := h.roleSvc.ListRoles(c.Context(), page, pageSize)
	if err != nil {
		return err
	}

	return response.Page(c, roles, total, page, pageSize)
}

func (h *RoleHandler) GetByID(c fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
	}

	role, err := h.roleRepo.GetByID(c.Context(), id)
	if err != nil {
		return errors.ErrRoleNotFound
	}

	return response.Success(c, role)
}

type CreateRoleRequest struct {
	Code        string `json:"code" validate:"required,min=2,max=32"`
	Name        string `json:"name" validate:"required,min=2,max=64"`
	Description string `json:"description"`
}

func (h *RoleHandler) Create(c fiber.Ctx) error {
	var req CreateRoleRequest
	if err := c.Bind().Body(&req); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "请求体格式错误")
	}

	role := domain.Role{
		Code:        req.Code,
		Name:        req.Name,
		Description: req.Description,
		Status:      1,
	}

	if err := h.roleSvc.CreateRole(c.Context(), &role); err != nil {
		return err
	}

	return response.Success(c, role)
}

type UpdateRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      *int   `json:"status"`
}

func (h *RoleHandler) Update(c fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
	}

	role, err := h.roleRepo.GetByID(c.Context(), id)
	if err != nil {
		return errors.ErrRoleNotFound
	}

	var req UpdateRoleRequest
	if err := c.Bind().Body(&req); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "请求体格式错误")
	}

	if req.Name != "" {
		role.Name = req.Name
	}
	if req.Description != "" {
		role.Description = req.Description
	}
	if req.Status != nil {
		role.Status = *req.Status
	}

	if err := h.roleSvc.UpdateRole(c.Context(), role); err != nil {
		return err
	}

	return response.Success(c, role)
}

func (h *RoleHandler) Delete(c fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
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
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
	}

	var req AssignPermissionsRequest
	if err := c.Bind().Body(&req); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "请求体格式错误")
	}

	if err := h.roleSvc.AssignPermissions(c.Context(), id, req.PermissionIDs); err != nil {
		return err
	}

	return response.Success(c, fiber.Map{"assigned": true})
}

func (h *RoleHandler) GetPermissionTree(c fiber.Ctx) error {
	tree, err := h.permRepo.GetTree(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, tree)
}
