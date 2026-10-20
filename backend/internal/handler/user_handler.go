package handler

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"infranexus/internal/middleware"
)

type UserHandler struct {
	userSvc domain.UserService
}

func NewUserHandler(userSvc domain.UserService) *UserHandler {
	return &UserHandler{userSvc: userSvc}
}

func (h *UserHandler) List(c fiber.Ctx) error {
	page, pageSize := pageParams(c, 10)
	filter := domain.UserFilter{
		Page:     page,
		PageSize: pageSize,
		Keyword:  strings.TrimSpace(c.Query("keyword")),
	}
	if st, err := strconv.Atoi(c.Query("status")); err == nil {
		filter.Status = &st
	}
	if roleID, err := uuid.Parse(c.Query("role_id")); err == nil {
		filter.RoleID = &roleID
	}

	users, total, err := h.userSvc.ListUsers(c.Context(), filter)
	if err != nil {
		return err
	}

	return response.Page(c, users, total, page, pageSize)
}

func (h *UserHandler) GetByID(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}

	user, err := h.userSvc.GetUser(c.Context(), id)
	if err != nil {
		return err
	}

	return response.Success(c, user)
}

func (h *UserHandler) Create(c fiber.Ctx) error {
	var req domain.CreateUserRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}

	user, err := h.userSvc.CreateUser(c.Context(), req)
	if err != nil {
		return err
	}

	return response.Success(c, user)
}

func (h *UserHandler) Update(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}

	var req domain.UpdateUserRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}

	user, err := h.userSvc.UpdateUser(c.Context(), actor.UserID, id, req)
	if err != nil {
		return err
	}

	return response.Success(c, user)
}

func (h *UserHandler) Delete(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}

	if err := h.userSvc.DeleteUser(c.Context(), actor.UserID, id); err != nil {
		return err
	}

	return response.Success(c, fiber.Map{"deleted": true})
}

type ToggleStatusRequest struct {
	Status int `json:"status" validate:"required,oneof=1 2"`
}

func (h *UserHandler) ToggleStatus(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}

	var req ToggleStatusRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}

	if err := h.userSvc.ToggleStatus(c.Context(), actor.UserID, id, req.Status); err != nil {
		return err
	}

	return response.Success(c, fiber.Map{"status": req.Status})
}

func (h *UserHandler) UpdateMyPreferences(c fiber.Ctx) error {
	userCtx, ok := c.Locals("current_user").(*middleware.UserContext)
	if !ok || userCtx == nil {
		return errors.ErrUnauthorized
	}

	var pref domain.UserPreferences
	if err := c.Bind().Body(&pref); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "偏好设置格式错误")
	}

	if err := h.userSvc.UpdatePreferences(c.Context(), userCtx.UserID, pref); err != nil {
		return err
	}

	return response.Success(c, pref)
}
