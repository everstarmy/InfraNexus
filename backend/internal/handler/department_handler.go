package handler

import (
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type DepartmentHandler struct {
	deptSvc domain.DepartmentService
}

func NewDepartmentHandler(deptSvc domain.DepartmentService) *DepartmentHandler {
	return &DepartmentHandler{deptSvc: deptSvc}
}

func (h *DepartmentHandler) Tree(c fiber.Ctx) error {
	tree, err := h.deptSvc.Tree(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, tree)
}

func (h *DepartmentHandler) GetByID(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	dept, err := h.deptSvc.Get(c.Context(), id)
	if err != nil {
		return err
	}
	return response.Success(c, dept)
}

func (h *DepartmentHandler) Create(c fiber.Ctx) error {
	var req domain.CreateDepartmentRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	dept, err := h.deptSvc.Create(c.Context(), req)
	if err != nil {
		return err
	}
	return response.Success(c, dept)
}

func (h *DepartmentHandler) Update(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	var req domain.UpdateDepartmentRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	dept, err := h.deptSvc.Update(c.Context(), id, req)
	if err != nil {
		return err
	}
	return response.Success(c, dept)
}

func (h *DepartmentHandler) Move(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	var req domain.MoveDepartmentRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	dept, err := h.deptSvc.Move(c.Context(), id, req.ParentID)
	if err != nil {
		return err
	}
	return response.Success(c, dept)
}

func (h *DepartmentHandler) Reorder(c fiber.Ctx) error {
	var req domain.ReorderDepartmentsRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	if err := h.deptSvc.Reorder(c.Context(), req.Items); err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"reordered": len(req.Items)})
}

func (h *DepartmentHandler) Delete(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	if err := h.deptSvc.Delete(c.Context(), id); err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"deleted": true})
}
