package errors

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"

	"infranexus/internal/core/response"
)

func TestGlobalErrorHandlerKeepsBusinessCodeAlignedWithHTTPStatus(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: GlobalErrorHandler})
	app.Get("/dup", func(c fiber.Ctx) error { return fmt.Errorf("insert: %w", gorm.ErrDuplicatedKey) })
	app.Get("/invalid", func(c fiber.Ctx) error {
		return NewDomainError(400, response.CodeParamInvalid, "请求参数校验失败").WithData([]string{"username"})
	})
	cases := []struct {
		path   string
		status int
		code   response.BusinessCode
		data   bool
	}{
		{"/dup", 409, response.CodeResourceConflict, false},
		{"/missing", 404, 404000, false},
		{"/invalid", 400, response.CodeParamInvalid, true},
	}
	for _, tc := range cases {
		res, err := app.Test(httptest.NewRequest("GET", tc.path, nil))
		if err != nil {
			t.Fatal(err)
		}
		var env response.Envelope[json.RawMessage]
		if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != tc.status || env.Code != tc.code {
			t.Fatalf("%s: got %d/%d", tc.path, res.StatusCode, env.Code)
		}
		if tc.data && string(env.Data) == "null" {
			t.Fatalf("%s: validation details dropped", tc.path)
		}
	}
}
