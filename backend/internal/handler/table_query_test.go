package handler_test

import (
	"context"
	"encoding/json/v2"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gofiber/fiber/v3"
	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
	"infranexus/internal/handler"
)

type tableQueryService struct {
	domain.UserService
	calls  int
	filter domain.UserFilter
}

func (s *tableQueryService) ListUsers(_ context.Context, f domain.UserFilter) ([]domain.User, int64, error) {
	s.calls++
	s.filter = f
	return []domain.User{}, 0, nil
}
func TestUserQueryHTTPBoundary(t *testing.T) {
	service := &tableQueryService{}
	app := fiber.New(fiber.Config{ErrorHandler: coreerrors.GlobalErrorHandler})
	app.Get("/users", handler.NewUserHandler(service).List)
	valid := `{"version":1,"search":"","filter":{"logic":"and","children":[{"field":"status","op":"eq","value":1}]},"sorts":[]}`
	response, err := app.Test(httptest.NewRequest("GET", "/users?query="+url.QueryEscape(valid)+"&page=2&page_size=20&department_id=none", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.UnmarshalRead(response.Body, &envelope); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || envelope.Code != 200000 || service.filter.Query == nil || service.filter.Page != 2 || !service.filter.NoDepartment {
		t.Fatalf("query was not propagated: status=%d filter=%+v", response.StatusCode, service.filter)
	}
	response, err = app.Test(httptest.NewRequest("GET", "/users?query="+url.QueryEscape(`{"version":99}`), nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 400 || service.calls != 1 {
		t.Fatalf("invalid query reached service: %d calls=%d", response.StatusCode, service.calls)
	}
}
