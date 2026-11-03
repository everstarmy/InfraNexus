package handler

import (
	"github.com/gofiber/fiber/v3"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type SetupHandler struct{ service domain.SetupService }

func NewSetupHandler(service domain.SetupService) *SetupHandler {
	return &SetupHandler{service: service}
}

func (h *SetupHandler) Status(c fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	status, err := h.service.Status(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, status)
}

func (h *SetupHandler) Initialize(c fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	status, err := h.service.Status(c.Context())
	if err != nil {
		return err
	}
	if status.Initialized {
		return coreerrors.ErrPermissionDenied.WithMessage("管理员已初始化，不能重复创建")
	}
	var req domain.SetupRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	if err := h.service.Initialize(c.Context(), req); err != nil {
		return err
	}
	return response.Success(c, domain.SetupStatus{Initialized: true})
}
