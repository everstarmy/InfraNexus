package handler

import (
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type OptionsHandler struct {
	roleSvc domain.RoleService
	deptSvc domain.DepartmentService
}

func NewOptionsHandler(roleSvc domain.RoleService, deptSvc domain.DepartmentService) *OptionsHandler {
	return &OptionsHandler{roleSvc: roleSvc, deptSvc: deptSvc}
}

type RoleOption struct {
	ID      uuid.UUID `json:"id"`
	Code    string    `json:"code"`
	Name    string    `json:"name"`
	Status  int       `json:"status"`
	BuiltIn bool      `json:"built_in"`
}

func (h *OptionsHandler) Roles(c fiber.Ctx) error {
	roles, err := h.roleSvc.Options(c.Context())
	if err != nil {
		return err
	}
	options := make([]RoleOption, 0, len(roles))
	for _, r := range roles {
		options = append(options, RoleOption{ID: r.ID, Code: r.Code, Name: r.Name, Status: r.Status, BuiltIn: r.BuiltIn})
	}
	return response.Success(c, options)
}

func (h *OptionsHandler) Departments(c fiber.Ctx) error {
	tree, err := h.deptSvc.Tree(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, tree)
}
