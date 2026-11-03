package middleware

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"

	coreerrors "infranexus/internal/core/errors"
)

func TestRequestLogStatusAndRequestIDMatchErrorResponse(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	app := fiber.New(fiber.Config{ErrorHandler: coreerrors.GlobalErrorHandler})
	app.Use(requestid.New())
	app.Use(RequestLogger(logger))
	app.Get("/conflict", func(fiber.Ctx) error {
		return coreerrors.ErrResourceConflict.WithMessage("resource conflict")
	})

	response, err := app.Test(httptest.NewRequest("GET", "/conflict", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var envelope struct {
		Code      int    `json:"code"`
		RequestID string `json:"request_id"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusConflict || envelope.RequestID == "" {
		t.Fatalf("error response status/request id: status=%d request_id=%q", response.StatusCode, envelope.RequestID)
	}
	var logRecord struct {
		RequestID    string `json:"request_id"`
		Status       int    `json:"status"`
		BusinessCode int    `json:"business_code"`
	}
	if err := json.Unmarshal(logs.Bytes(), &logRecord); err != nil {
		t.Fatal(err)
	}
	if logRecord.RequestID != envelope.RequestID || logRecord.Status != response.StatusCode || logRecord.BusinessCode != envelope.Code {
		t.Fatalf("response/log mismatch: response=%+v log=%+v", envelope, logRecord)
	}
}
