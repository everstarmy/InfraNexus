package handler

import (
	"strconv"

	"github.com/gofiber/fiber/v3"

	coreerrors "infranexus/internal/core/errors"
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
	var dept *domain.Department
	if req.TargetID != nil {
		if req.Position == "" || req.ParentID != nil {
			return coreerrors.ErrParamInvalid.WithMessage("相对移动需要 target_id 和 position，不能同时指定 parent_id")
		}
		dept, err = h.deptSvc.MoveRelative(c.Context(), id, *req.TargetID, req.Position, req.ExpectedRevision)
	} else {
		if req.Position != "" {
			return coreerrors.ErrParamInvalid.WithMessage("position 需要配合 target_id 使用")
		}
		dept, err = h.deptSvc.Move(c.Context(), id, req.ParentID, req.ExpectedRevision)
	}
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
	if err := h.deptSvc.Reorder(c.Context(), req.Items, req.ExpectedRevision); err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"reordered": len(req.Items)})
}

func (h *DepartmentHandler) Delete(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	expectedRevision, err := strconv.ParseInt(c.Query("expected_revision"), 10, 64)
	if err != nil || expectedRevision < 1 {
		return coreerrors.ErrParamInvalid.WithMessage("expected_revision 必须为正整数")
	}
	if err := h.deptSvc.Delete(c.Context(), id, expectedRevision); err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"deleted": true})
}
