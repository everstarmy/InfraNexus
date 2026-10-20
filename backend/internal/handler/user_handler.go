package handler

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/core/validator"
	"infranexus/internal/domain"
	"infranexus/internal/middleware"
)

type UserHandler struct {
	userSvc  domain.UserService
	userRepo domain.UserRepository
}

func NewUserHandler(userSvc domain.UserService, userRepo domain.UserRepository) *UserHandler {
	return &UserHandler{
		userSvc:  userSvc,
		userRepo: userRepo,
	}
}

func (h *UserHandler) List(c fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	pageSize, _ := strconv.Atoi(c.Query("page_size", "10"))
	keyword := c.Query("keyword", "")

	filters := map[string]any{
		"keyword": keyword,
	}

	if statusStr := c.Query("status", ""); statusStr != "" {
		if st, err := strconv.Atoi(statusStr); err == nil {
			filters["status"] = st
		}
	}

	if roleIDStr := c.Query("role_id", ""); roleIDStr != "" {
		if rID, err := uuid.Parse(roleIDStr); err == nil {
			filters["role_id"] = rID
		}
	}

	users, total, err := h.userRepo.List(c.Context(), page, pageSize, filters)
	if err != nil {
		return err
	}

	return response.Page(c, users, total, page, pageSize)
}

func (h *UserHandler) GetByID(c fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
	}

	user, err := h.userRepo.GetByID(c.Context(), id)
	if err != nil {
		return errors.ErrUserNotFound
	}

	return response.Success(c, user)
}

func (h *UserHandler) Create(c fiber.Ctx) error {
	var req domain.CreateUserRequest
	if err := c.Bind().Body(&req); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "请求体格式错误")
	}

	if err := validator.ValidateRequest(c, req); err != nil {
		return err
	}

	user, err := h.userSvc.CreateUser(c.Context(), req)
	if err != nil {
		return err
	}

	return response.Success(c, user)
}

func (h *UserHandler) Update(c fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
	}

	var req domain.UpdateUserRequest
	if err := c.Bind().Body(&req); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "请求体格式错误")
	}

	user, err := h.userSvc.UpdateUser(c.Context(), id, req)
	if err != nil {
		return err
	}

	return response.Success(c, user)
}

func (h *UserHandler) Delete(c fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
	}

	if err := h.userSvc.DeleteUser(c.Context(), id); err != nil {
		return err
	}

	return response.Success(c, fiber.Map{"deleted": true})
}

type ToggleStatusRequest struct {
	Status int `json:"status" validate:"required,oneof=1 2"`
}

func (h *UserHandler) ToggleStatus(c fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "非法的 UUID 格式")
	}

	var req ToggleStatusRequest
	if err := c.Bind().Body(&req); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeParamInvalid, "请求体格式错误")
	}

	if err := h.userSvc.ToggleStatus(c.Context(), id, req.Status); err != nil {
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
