package handler

import (
	"errors"
	"io"
	"slices"
	"strconv"
	"strings"

	"encoding/json/jsontext"
	json "encoding/json/v2"
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func receivingError(err error) error {
	v, ok := errors.AsType[*domain.ReceivingError](err)
	if !ok {
		return err
	}
	status := 409
	code := response.CodeResourceConflict
	switch v.Reason {
	case "VALIDATION_FAILED", "LIMIT_EXCEEDED":
		status = 400
		code = response.CodeParamInvalid
	case "RESOURCE_NOT_FOUND":
		status = 404
		code = response.CodeManagedNotFound
	case "PERMISSION_DENIED":
		status = 403
		code = response.CodePermissionDenied
	case "UPLOAD_TOO_LARGE":
		status = 413
		code = 413000
	case "UNSUPPORTED_IMAGE_TYPE":
		status = 415
		code = 415000
	}
	return coreerrors.NewDomainError(status, code, v.Message).WithData(v)
}
func RegisterReceivingRoutes(router fiber.Router, svc domain.ReceivingService, authz domain.AuthorizationService) {
	for _, route := range domain.ReceivingRoutes() {
		router.Add([]string{route.Method}, route.Path, func(c fiber.Ctx) error {
			actor, e := managedActor(c)
			if e != nil {
				return e
			}
			call := domain.ReceivingCall{Operation: route.Operation, ActorID: actor, Key: strings.Clone(c.Get("Idempotency-Key")), Query: map[string]string{}}
			for name, ptr := range map[string]*uuid.UUID{"id": &call.ID, "childID": &call.ChildID, "itemID": &call.ItemID, "componentID": &call.ComponentID} {
				if raw := c.Params(name); raw != "" {
					id, e := uuid.Parse(raw)
					if e != nil || id == uuid.Nil {
						return coreerrors.ErrParamInvalid.WithMessage("资源 ID 无效")
					}
					*ptr = id
				}
			}
			for _, key := range []string{"page", "page_size", "search", "selectable", "slot_key", "status", "state", "kind", "category", "manufacturer_id", "supplier_id", "purchase_batch_id", "device_model_id", "part_model_id", "source_device_id", "current_device_id", "warehouse_id", "lifecycle_state", "source_receipt_id", "serial_status", "placement_kind", "expected_version", "expected_configuration_version", "include_current_identity", "filter", "created_from", "created_to"} {
				if v := c.Query(key); v != "" {
					call.Query[key] = strings.Clone(v)
				}
			}
			requireKey := route.Method == "POST" && !strings.HasSuffix(route.Operation, ".preview") || route.Operation == "asset.components.serial"
			if requireKey && call.Key == "" {
				return coreerrors.ErrParamInvalid.WithMessage("请提供 Idempotency-Key")
			}
			if route.Operation == "receipt.photos.create" {
				v, e := strconv.ParseInt(c.FormValue("expected_version"), 10, 64)
				if e != nil || v < 1 {
					return coreerrors.ErrParamInvalid.WithMessage("缺少 expected_version")
				}
				raw, e := json.Marshal(struct {
					ExpectedVersion int64 `json:"expected_version"`
				}{v})
				if e != nil {
					return e
				}
				call.Body = raw
				f, e := c.FormFile("file")
				if e != nil {
					return coreerrors.ErrParamInvalid.WithMessage("缺少图片文件")
				}
				if f.Size > 10*1024*1024 {
					return receivingError(&domain.ReceivingError{Reason: "UPLOAD_TOO_LARGE", Message: "图片超过 10 MiB"})
				}
				file, e := f.Open()
				if e != nil {
					return e
				}
				b, readErr := io.ReadAll(io.LimitReader(file, 10*1024*1024+1))
				closeErr := file.Close()
				if readErr != nil {
					return readErr
				}
				if closeErr != nil {
					return closeErr
				}
				call.File = b
				if len(f.Filename) > 255 || strings.ContainsRune(f.Filename, 0) {
					return coreerrors.ErrParamInvalid.WithMessage("图片文件名无效")
				}
				call.Filename = strings.Clone(f.Filename)
			} else if route.Method != "GET" && route.Method != "DELETE" {
				var raw jsontext.Value
				if e = c.Bind().JSON(&raw); e != nil {
					return coreerrors.ErrParamInvalid.WithMessage("请求 JSON 无效")
				}
				call.Body = append(jsontext.Value(nil), raw...)
			}
			if route.Operation == "asset.attachments.content" {
				p, e := currentPrincipal(c)
				if e != nil {
					return e
				}
				codes, admin, e := authz.EffectivePermissions(c.Context(), p.Roles)
				if e != nil {
					return e
				}
				call.CanReadReceipt = admin || slices.Contains(codes, domain.APIPermissionCode("GET", "/api/v1/receipts/:id"))
				call.CanReadDevice = admin || slices.Contains(codes, domain.APIPermissionCode("GET", "/api/v1/assets/devices/:id"))
			}
			result, e := svc.Execute(c.Context(), call)
			if e != nil {
				return receivingError(e)
			}
			if file, ok := result.(domain.ReceivingFile); ok {
				c.Set("Content-Type", file.MIME)
				c.Set("Cache-Control", "private, no-store")
				c.Set("X-Content-Type-Options", "nosniff")
				return c.Send(file.Content)
			}
			return response.Success(c, result)
		})
	}
}
