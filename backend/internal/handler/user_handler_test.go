package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
	"infranexus/internal/handler"
	"infranexus/internal/middleware"
)

type preferenceService struct {
	domain.UserService
	saved bool
}

func (s *preferenceService) UpdatePreferences(_ context.Context, _ uuid.UUID, _ domain.UserPreferences) error {
	s.saved = true
	return nil
}

type idleUpdateFailure struct {
	domain.AuthService
}

func (idleUpdateFailure) UpdateSessionIdle(context.Context, string, int) error {
	return errors.New("session store unavailable")
}

func TestPreferenceSaveReportsSessionTimeoutPartialFailure(t *testing.T) {
	prefs := &preferenceService{}
	auth := idleUpdateFailure{}
	users := handler.NewUserHandler(prefs, auth)
	app := fiber.New(fiber.Config{ErrorHandler: coreerrors.GlobalErrorHandler})
	app.Use(requestid.New())
	app.Use(func(c fiber.Ctx) error {
		c.Locals("current_user", &middleware.UserContext{UserID: uuid.New()})
		c.Locals("current_principal", &domain.Principal{SessionID: "current-session"})
		return c.Next()
	})
	app.Put("/preferences", users.UpdateMyPreferences)

	request := httptest.NewRequest(http.MethodPut, "/preferences", strings.NewReader(`{"theme":"dark","session_timeout":600}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("HTTP status=%d, want 503", response.StatusCode)
	}
	var envelope struct {
		Code      int             `json:"code"`
		RequestID string          `json:"request_id"`
		Data      json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != int(coreerrors.ErrAuthorizationUnavailable.BizCode) || envelope.RequestID == "" || !prefs.saved {
		t.Fatalf("partial response metadata missing: code=%d request_id=%q saved=%t", envelope.Code, envelope.RequestID, prefs.saved)
	}
	var data map[string]bool
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatal(err)
	}
	if !data["preferences_saved"] || data["session_timeout_applied"] {
		t.Fatalf("partial result was not explicit: %+v", data)
	}
}
