package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/valyala/fasthttp"

	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
)

// SSEConnectionMaxLifetime bounds both the response socket and its producer.
const SSEConnectionMaxLifetime = 2 * time.Minute

const (
	sseReadBlock       = 10 * time.Second
	sseAuthCheckPeriod = 20 * time.Second
	sseBatchLimit      = 100
)

type SSEHandler struct {
	events domain.SSEEventStore
	auth   domain.AuthService
	authz  domain.AuthorizationService
	logger *slog.Logger
	life   context.Context
}

func NewSSEHandler(events domain.SSEEventStore, auth domain.AuthService, authz domain.AuthorizationService, logger *slog.Logger, lifecycle context.Context) *SSEHandler {
	if logger == nil {
		logger = slog.Default()
	}
	if lifecycle == nil {
		lifecycle = context.Background()
	}
	return &SSEHandler{events: events, auth: auth, authz: authz, logger: logger, life: lifecycle}
}

// StreamNotifications binds the stream to the authenticated identity and
// periodically validates the session and the permission that opened it.
func (h *SSEHandler) StreamNotifications(c fiber.Ctx) error {
	principal, ok := c.Locals("current_principal").(*domain.Principal)
	if !ok || principal == nil {
		return fiber.ErrUnauthorized
	}
	if h.events == nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "event stream is unavailable")
	}
	requestID := requestmeta.RequestID(c.Context())
	logger := h.logger.With("request_id", requestID, "user_id", principal.UserID)
	lastID := c.Get("Last-Event-ID")
	if lastID == "" {
		lastID = c.Query("lastEventId")
	}
	if lastID != "" && !validSSECursor(lastID) {
		return fiber.ErrBadRequest
	}
	if lastID == "" {
		var err error
		lastID, err = h.events.LatestID(c.Context())
		if err != nil {
			return fiber.NewError(fiber.StatusServiceUnavailable, "event stream is unavailable")
		}
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache, no-transform")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")
	c.Set("Transfer-Encoding", "chunked")

	owner := *principal
	owner.Roles = append([]string(nil), principal.Roles...)
	connection := c.RequestCtx().Conn()
	streamCtx, cancelStream := context.WithTimeout(h.life, SSEConnectionMaxLifetime)
	stopClose := context.AfterFunc(streamCtx, func() {
		if connection != nil {
			_ = connection.Close()
		}
	})
	body := fasthttp.NewStreamReader(func(w *bufio.Writer) {
		defer cancelStream()
		defer stopClose()
		if err := writeSSE(w, lastID, "connected", []byte(`{"status":"connected"}`)); err != nil {
			logger.Debug("Write SSE connected event failed", "error_type", fmt.Sprintf("%T", err))
			return
		}
		if err := w.Flush(); err != nil {
			logger.Debug("Flush SSE connected event failed", "error_type", fmt.Sprintf("%T", err))
			return
		}

		current := &owner
		lastAuthCheck := time.Now()
		for {
			if time.Since(lastAuthCheck) >= sseAuthCheckPeriod {
				validated, err := h.validateStreamIdentity(streamCtx, current)
				if err != nil {
					_ = writeSSE(w, "", "auth.expired", []byte(`{"status":"closed"}`))
					_ = w.Flush()
					logger.Info("SSE stream closed after identity validation failed", "error_type", fmt.Sprintf("%T", err))
					return
				}
				current = validated
				lastAuthCheck = time.Now()
			}

			ctx, cancel := context.WithTimeout(streamCtx, sseReadBlock+time.Second)
			events, _, err := h.events.Read(ctx, lastID, sseReadBlock, sseBatchLimit)
			cancel()
			if err != nil {
				if streamCtx.Err() != nil {
					return
				}
				logger.Warn("Read SSE event stream failed", "error_type", fmt.Sprintf("%T", err))
				return
			}
			if len(events) == 0 {
				if _, err := fmt.Fprint(w, ": keep-alive\n\n"); err != nil {
					logger.Debug("Write SSE heartbeat failed", "error_type", fmt.Sprintf("%T", err))
					return
				}
				if err := w.Flush(); err != nil {
					logger.Debug("Flush SSE heartbeat failed", "error_type", fmt.Sprintf("%T", err))
					return
				}
				continue
			}
			for _, event := range events {
				if time.Since(lastAuthCheck) >= sseAuthCheckPeriod {
					validated, err := h.validateStreamIdentity(streamCtx, current)
					if err != nil {
						_ = writeSSE(w, "", "auth.expired", []byte(`{"status":"closed"}`))
						_ = w.Flush()
						logger.Info("SSE stream closed after identity validation failed", "error_type", fmt.Sprintf("%T", err))
						return
					}
					current = validated
					lastAuthCheck = time.Now()
				}
				if err := writeSSE(w, event.ID, event.Name, event.Data); err != nil {
					logger.Debug("Write SSE event failed", "event", event.Name, "error_type", fmt.Sprintf("%T", err))
					return
				}
				if err := w.Flush(); err != nil {
					logger.Debug("Flush SSE event failed", "event", event.Name, "error_type", fmt.Sprintf("%T", err))
					return
				}
				lastID = event.ID
			}
		}
	})
	// fasthttp closes the body on socket failure. Propagate that close to a
	// pending Redis read rather than waiting for the next producer write.
	err := c.SendStream(&sseResponseStream{ReadCloser: body, cancel: cancelStream})
	if err != nil {
		_ = body.Close()
		cancelStream()
		stopClose()
	}
	return err
}

type sseResponseStream struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (s *sseResponseStream) Close() error {
	s.cancel()
	return s.ReadCloser.Close()
}

func (h *SSEHandler) validateStreamIdentity(parent context.Context, principal *domain.Principal) (*domain.Principal, error) {
	ctx, cancel := context.WithTimeout(parent, 4*time.Second)
	defer cancel()
	validated, err := h.auth.ValidateStreamPrincipal(ctx, principal)
	if err != nil {
		return nil, err
	}
	allowed, err := h.authz.HasAPIAccess(ctx, validated.Roles, "GET", "/api/v1/ldap/sync-logs")
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, fiber.ErrForbidden
	}
	return validated, nil
}

func writeSSE(w *bufio.Writer, id, event string, data []byte) error {
	if event == "" || strings.ContainsAny(event, "\r\n") || strings.ContainsAny(id, "\r\n") {
		return fmt.Errorf("invalid SSE event metadata")
	}
	if len(data) == 0 {
		data = []byte("null")
	}
	if !json.Valid(data) {
		return fmt.Errorf("invalid SSE event payload")
	}
	if _, err := fmt.Fprintf(w, "id: %s\nevent: %s\ndata: %s\n\n", id, event, json.RawMessage(data)); err != nil {
		return err
	}
	return nil
}

func validSSECursor(id string) bool {
	parts := strings.Split(id, "-")
	if len(parts) != 2 {
		return false
	}
	_, firstErr := strconv.ParseUint(parts[0], 10, 64)
	_, secondErr := strconv.ParseUint(parts[1], 10, 64)
	return firstErr == nil && secondErr == nil
}
