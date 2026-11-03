package handler

import (
	"strconv"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func (h *UserHandler) PreviewStatus(c fiber.Ctx) error {
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	var req domain.UserBatchRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	result, err := h.userSvc.PreviewStatus(c.Context(), actor.UserID, req)
	if err != nil {
		return err
	}
	return response.Success(c, result)
}
func (h *UserHandler) BatchStatus(c fiber.Ctx) error {
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	var req domain.UserBatchRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	result, err := h.userSvc.BatchStatus(c.Context(), actor.UserID, req)
	if err != nil {
		return err
	}
	return response.Success(c, result)
}
func (h *UserHandler) Export(c fiber.Ctx) error {
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	var req domain.UserExportRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	result, err := h.userSvc.ExportUsers(c.Context(), actor.UserID, req)
	if err != nil {
		return err
	}
	c.Set("Content-Type", "text/csv; charset=utf-8")
	c.Set("Content-Disposition", `attachment; filename="users.csv"`)
	c.Set("Cache-Control", "no-store")
	c.Set("X-Export-Row-Count", strconv.Itoa(result.Rows))
	return c.Send(result.Content)
}
