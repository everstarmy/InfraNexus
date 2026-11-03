package handler

import (
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type DashboardHandler struct {
	dashboardSvc domain.DashboardService
}

func NewDashboardHandler(dashboardSvc domain.DashboardService) *DashboardHandler {
	return &DashboardHandler{dashboardSvc: dashboardSvc}
}

func (h *DashboardHandler) Overview(c fiber.Ctx) error {
	overview, err := h.dashboardSvc.Overview(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, overview)
}
