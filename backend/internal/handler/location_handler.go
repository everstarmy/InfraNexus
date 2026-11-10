package handler

import (
	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func RegisterRackInventoryRoute(router fiber.Router, service domain.RackInventoryService) {
	router.Get("/:id/units", func(c fiber.Ctx) error {
		id, err := parseIDParam(c)
		if err != nil {
			return err
		}
		item, err := service.Units(c.Context(), id)
		if err != nil {
			return managedError(err)
		}
		return response.Success(c, item)
	})
}
