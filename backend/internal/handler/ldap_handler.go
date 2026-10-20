package handler

import (
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

type LDAPHandler struct {
	ldapSvc domain.LDAPService
}

func NewLDAPHandler(ldapSvc domain.LDAPService) *LDAPHandler {
	return &LDAPHandler{ldapSvc: ldapSvc}
}

func (h *LDAPHandler) ListConfigs(c fiber.Ctx) error {
	configs, err := h.ldapSvc.ListConfigs(c.Context())
	if err != nil {
		return err
	}
	return response.Success(c, configs)
}

func (h *LDAPHandler) GetConfig(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	cfg, err := h.ldapSvc.GetConfig(c.Context(), id)
	if err != nil {
		return err
	}
	return response.Success(c, cfg)
}

func (h *LDAPHandler) CreateConfig(c fiber.Ctx) error {
	var req domain.LDAPConfigRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	cfg, err := h.ldapSvc.CreateConfig(c.Context(), req)
	if err != nil {
		return err
	}
	return response.Success(c, cfg)
}

func (h *LDAPHandler) UpdateConfig(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	var req domain.LDAPConfigRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	cfg, err := h.ldapSvc.UpdateConfig(c.Context(), id, req)
	if err != nil {
		return err
	}
	return response.Success(c, cfg)
}

func (h *LDAPHandler) DeleteConfig(c fiber.Ctx) error {
	id, err := parseIDParam(c)
	if err != nil {
		return err
	}
	if err := h.ldapSvc.DeleteConfig(c.Context(), id); err != nil {
		return err
	}
	return response.Success(c, fiber.Map{"deleted": true})
}

func (h *LDAPHandler) Test(c fiber.Ctx) error {
	var req domain.LDAPTestRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	result, err := h.ldapSvc.TestConnection(c.Context(), req)
	if err != nil {
		return err
	}
	return response.Success(c, result)
}

func (h *LDAPHandler) Preview(c fiber.Ctx) error {
	var req domain.LDAPSyncRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	plan, err := h.ldapSvc.Preview(c.Context(), req.ConfigID, req.Mode)
	if err != nil {
		return err
	}
	return response.Success(c, plan)
}

func (h *LDAPHandler) Sync(c fiber.Ctx) error {
	var req domain.LDAPSyncRequest
	if err := bindBody(c, &req); err != nil {
		return err
	}
	actor, err := currentPrincipal(c)
	if err != nil {
		return err
	}
	log, err := h.ldapSvc.StartSync(c.Context(), req.ConfigID, req.Mode, domain.SyncTriggerManual, &actor.UserID)
	if err != nil {
		return err
	}
	return response.Success(c, log)
}

func (h *LDAPHandler) SyncLogs(c fiber.Ctx) error {
	page, pageSize := pageParams(c, 10)
	var configID *uuid.UUID
	if id, err := uuid.Parse(c.Query("config_id")); err == nil {
		configID = &id
	}
	logs, total, err := h.ldapSvc.ListSyncLogs(c.Context(), configID, page, pageSize)
	if err != nil {
		return err
	}
	return response.Page(c, logs, total, page, pageSize)
}
