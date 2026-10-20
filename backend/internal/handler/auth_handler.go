package handler

import (
	"strings"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/config"
	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"infranexus/internal/middleware"
)

type AuthHandler struct {
	cfg     *config.Config
	authSvc domain.AuthService
}

func NewAuthHandler(cfg *config.Config, authSvc domain.AuthService) *AuthHandler {
	return &AuthHandler{cfg, authSvc}
}

type LoginRequest struct {
	Username string `json:"username" validate:"required,min=3,max=64"`
	Password string `json:"password" validate:"required,min=6,max=64"`
}
type LoginResponse struct {
	User *domain.CurrentUser `json:"user"`
}

func (h *AuthHandler) Login(c fiber.Ctx) error {
	var req LoginRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	user, sess, err := h.authSvc.Login(c.Context(), req.Username, req.Password, c.Cookies(h.cfg.Session.CookieName))
	if err != nil {
		return err
	}
	middleware.SetSessionCookie(c, h.cfg, sess.ID, sess.ExpiresAt)
	profile, err := h.authSvc.Profile(c.Context(), user.ID)
	if err != nil {
		return err
	}
	return response.Success(c, LoginResponse{User: profile})
}
func (h *AuthHandler) Token(c fiber.Ctx) error {
	var req LoginRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	tokens, err := h.authSvc.IssueTokens(c.Context(), req.Username, req.Password)
	if err != nil {
		return err
	}
	return response.Success(c, tokens)
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

func (h *AuthHandler) Refresh(c fiber.Ctx) error {
	var req RefreshRequest
	if err := c.Bind().Body(&req); err != nil {
		return response.Error(c, 400, response.CodeParamInvalid, "请求数据格式错误")
	}
	if strings.TrimSpace(req.RefreshToken) == "" {
		return response.Error(c, 400, response.CodeParamInvalid, "缺少刷新令牌")
	}
	tokens, err := h.authSvc.RefreshToken(c.Context(), req.RefreshToken)
	if err != nil {
		return err
	}
	return response.Success(c, tokens)
}
func (h *AuthHandler) Logout(c fiber.Ctx) error {
	p, ok := c.Locals("current_principal").(*domain.Principal)
	if !ok {
		return coreerrors.ErrUnauthorized
	}
	if err := h.authSvc.Logout(c.Context(), p); err != nil {
		return err
	}
	middleware.ClearSessionCookie(c, h.cfg)
	return response.Success(c, struct {
		LoggedOut bool `json:"logged_out"`
	}{true})
}
func (h *AuthHandler) Me(c fiber.Ctx) error {
	p, ok := c.Locals("current_principal").(*domain.Principal)
	if !ok {
		return coreerrors.ErrUnauthorized
	}
	profile, err := h.authSvc.Profile(c.Context(), p.UserID)
	if err != nil {
		return err
	}
	return response.Success(c, profile)
}
