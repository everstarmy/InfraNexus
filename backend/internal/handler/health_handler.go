package handler

import (
	"github.com/gofiber/fiber/v3"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type HealthHandler struct{ service domain.HealthService }

func NewHealthHandler(service domain.HealthService) *HealthHandler { return &HealthHandler{service} }
func (h *HealthHandler) Ready(c fiber.Ctx) error {
	if err := h.service.Ready(c.Context()); err != nil {
		return err
	}
	return response.Success(c, domain.HealthStatus{Status: "ready"})
}
