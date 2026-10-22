package handler

import (
	"encoding/json"
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
	authSvc domain.AuthService
}

func NewUserHandler(userSvc domain.UserService, authSvc ...domain.AuthService) *UserHandler {
	var auth domain.AuthService
	if len(authSvc) > 0 {
		auth = authSvc[0]
	}
	return &UserHandler{userSvc: userSvc, authSvc: auth}
}

func (h *UserHandler) List(c fiber.Ctx) error {
	page, pageSize := pageParams(c, 10)
	filter := domain.UserFilter{
		Page:            page,
		PageSize:        pageSize,
		Keyword:         strings.TrimSpace(c.Query("keyword")),
		Statuses:        queryInts(c, "status"),
		AuthTypes:       queryStrings(c, "auth_type"),
		RoleIDs:         queryUUIDs(c, "role_id"),
		IncludeChildren: c.Query("include_children") == "true",
		NoDepartment:    c.Query("department_id") == "none",
		Sort:            c.Query("sort"),
	}
	if deptID, err := uuid.Parse(c.Query("department_id")); err == nil {
		filter.DepartmentID = &deptID
	}

	users, total, err := h.userSvc.ListUsers(c.Context(), filter)
	if err != nil {
		return err
	}

	return response.Page(c, users, total, page, pageSize)
}

func (h *UserHandler) Stats(c fiber.Ctx) error {
	stats, err := h.userSvc.Stats(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, stats)
}

func (h *UserHandler) ResetPassword(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	var req domain.ResetPasswordRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	if err := h.userSvc.ResetPassword(c.Context(), actor.UserID, id, req.Password); err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"reset": true, "sessions_revoked": true})
}

func (h *UserHandler) AssignRoles(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	var req domain.AssignRolesRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	if req.RoleIDs == nil {
		req.RoleIDs = []uuid.UUID{}
	}
	user, err := h.userSvc.AssignRoles(c.Context(), actor.UserID, id, req.RoleIDs)
	if err != nil {
		return err
	}
	return response.Success(c, user)
}

func (h *UserHandler) BatchMoveDepartment(c fiber.Ctx) error {
	var req domain.BatchMoveDepartmentRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	moved, err := h.userSvc.BatchMoveDepartment(c.Context(), req.UserIDs, req.TargetDeptID, req.ExpectedRevision)
	if err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"moved": moved})
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
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	var req domain.CreateUserRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}

	user, err := h.userSvc.CreateUser(c.Context(), actor.UserID, req)
	if err != nil {
		return err
	}

	return response.Success(c, user)
}

func (h *UserHandler) SetDepartment(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(c.Body(), &fields); err != nil || fields == nil {
		return errors.ErrParamInvalid.WithMessage("请求体格式错误")
	}
	if len(fields) != 2 {
		return errors.ErrParamInvalid.WithMessage("请求体仅允许包含 department_id 与 expected_revision")
	}
	raw, ok := fields["department_id"]
	if !ok {
		return errors.ErrParamInvalid.WithMessage("必须显式提供 department_id（UUID 或 null）")
	}
	var departmentID *uuid.UUID
	if string(raw) != "null" {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return errors.ErrParamInvalid.WithMessage("department_id 必须为 UUID 或 null")
		}
		parsed, err := uuid.Parse(text)
		if err != nil {
			return errors.ErrParamInvalid.WithMessage("department_id 必须为 UUID 或 null")
		}
		departmentID = &parsed
	}
	expectedRevision, ok := fields["expected_revision"]
	if !ok {
		return errors.ErrParamInvalid.WithMessage("必须提供 expected_revision")
	}
	var revision int64
	if err := json.Unmarshal(expectedRevision, &revision); err != nil || revision < 1 {
		return errors.ErrParamInvalid.WithMessage("expected_revision 必须为正整数")
	}
	user, err := h.userSvc.SetDepartment(c.Context(), actor.UserID, id, departmentID, revision)
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
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(c.Body(), &fields); err != nil || fields == nil {
		return errors.ErrParamInvalid.WithMessage("请求体格式错误")
	}
	allowed := map[string]bool{"nickname": true, "email": true, "avatar": true, "expected_revision": true}
	for field := range fields {
		if allowed[field] {
			continue
		}
		switch field {
		case "status", "role_ids", "department_id":
			return errors.ErrParamInvalid.WithMessage(field + " 必须通过专用接口修改")
		default:
			return errors.ErrParamInvalid.WithMessage("用户资料只允许修改 nickname、email、avatar")
		}
	}
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
	Status           int   `json:"status" validate:"required,oneof=1 2"`
	ExpectedRevision int64 `json:"expected_revision" validate:"omitempty,gt=0"`
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

	user, err := h.userSvc.ToggleStatus(c.Context(), actor.UserID, id, req.Status, req.ExpectedRevision)
	if err != nil {
		return err
	}

	return response.Success(c, user)
}

func (h *UserHandler) UpdateMyPreferences(c fiber.Ctx) error {
	userCtx, ok := c.Locals("current_user").(*middleware.UserContext)
	if !ok || userCtx == nil {
		return errors.ErrUnauthorized
	}

	var pref domain.UserPreferences
	if err := c.Bind().Body(&pref); err != nil {
		return errors.ErrParamInvalid.WithMessage("偏好设置格式错误")
	}

	if err := h.userSvc.UpdatePreferences(c.Context(), userCtx.UserID, pref); err != nil {
		return err
	}

	if h.authSvc != nil {
		if p, ok := c.Locals("current_principal").(*domain.Principal); ok && p != nil && p.SessionID != "" {
			if err := h.authSvc.UpdateSessionIdle(c.Context(), p.SessionID, pref.SessionTimeout); err != nil {
				return errors.NewDomainError(fiber.StatusServiceUnavailable, response.CodeAuthorizationUnavailable, "偏好已保存，但当前会话超时尚未生效", err).
					WithData(fiber.Map{"preferences_saved": true, "session_timeout_applied": false})
			}
		}
	}

	return response.Success(c, pref)
}
