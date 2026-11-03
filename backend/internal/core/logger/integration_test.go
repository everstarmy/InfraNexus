package logger_test

import (
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	recovermw "github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"infranexus/internal/config"
	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/logger"
	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
	"infranexus/internal/handler"
	"infranexus/internal/middleware"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

// Exercise the real auth handler/service/repository using a failing auxiliary
// update: login must succeed while the service warning and SQL failure share ID.
func TestHTTPServiceSQLCorrelation(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			var dialector gorm.Dialector
			if driver == "postgres" {
				dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN for isolated PostgreSQL")
				}
				dialector = postgres.Open(dsn)
			} else {
				dialector = sqlite.Open(filepath.Join(t.TempDir(), "logging.db"))
			}
			c := &config.Config{App: config.AppConfig{Name: "logging-test", Env: "test"}, Logging: config.DefaultLogging(false, "test")}
			c.Logging.Output = "file"
			c.Logging.File.Directory = t.TempDir()
			c.Logging.SQL.Level = "info"
			c.Session = config.SessionConfig{CookieName: "test-session", MaxAge: 60, AbsoluteMaxAge: 600}
			logs, err := logger.New(c)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = logs.Close() })
			db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.NewGORM(logs.Logger, c.Logging.SQL, driver)})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = sqlDB.Close() })
			if driver == "postgres" {
				schema := "logging_" + strings.ReplaceAll(uuid.NewString(), "-", "")
				if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec("SET search_path TO " + schema).Error; err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Exec("DROP SCHEMA " + schema + " CASCADE").Error })
			}
			if err := db.AutoMigrate(&domain.Department{}, &domain.Permission{}, &domain.Role{}, &domain.User{}); err != nil {
				t.Fatal(err)
			}
			hash, err := bcrypt.GenerateFromPassword([]byte("Password!123"), bcrypt.MinCost)
			if err != nil {
				t.Fatal(err)
			}
			user := domain.User{Username: "PRIVATE_USERNAME_SENTINEL", Password: string(hash), AuthType: domain.AuthTypeLocal, Status: 1}
			if err := db.Create(&user).Error; err != nil {
				t.Fatal(err)
			}
			// Generate a real constraint error with a sensitive key in driver detail.
			duplicate := domain.User{Username: user.Username, Password: string(hash), AuthType: domain.AuthTypeLocal, Status: 1}
			if err := db.Create(&duplicate).Error; err == nil {
				t.Fatal("expected duplicate error")
			}
			// Force only last_login_at SQL to fail without failing credential lookup.
			if err := db.Callback().Update().Before("gorm:update").Register("logging:aux_failure", func(tx *gorm.DB) {
				if values, ok := tx.Statement.Dest.(map[string]any); ok {
					if _, has := values["last_login_at"]; has {
						tx.AddError(errors.New("PRIVATE_DRIVER_SENTINEL"))
					}
				}
			}); err != nil {
				t.Fatal(err)
			}
			svc := service.NewAuthService(c, repository.NewUserRepository(db), repository.NewAuthRepository(nil), nil, nil, logs.Logger)
			auth := handler.NewAuthHandler(c, svc)
			// Token uses real credentials and last-login update without Profile/authz.
			c.JWT = config.JWTConfig{Secret: "logging-test-secret-at-least-32-bytes", Issuer: "test", AccessTokenExpire: 60, RefreshTokenExpire: 600}
			app := fiber.New(fiber.Config{ErrorHandler: coreerrors.GlobalErrorHandler})
			app.Use(middleware.RequestID())
			app.Use(middleware.RequestLogger(logs.Logger))
			app.Use(func(c fiber.Ctx) error {
				if requestid.FromContext(c) != requestmeta.RequestID(c.Context()) {
					t.Error("Fiber and standard Context IDs differ")
					return errors.New("Fiber and standard Context IDs differ")
				}
				return c.Next()
			})
			app.Use(recovermw.New(recovermw.Config{PanicHandler: func(_ fiber.Ctx, _ any) error { return fiber.ErrInternalServerError }}))
			app.Use(cors.New(cors.Config{AllowOrigins: []string{"https://example.test"}}))
			app.Post("/token", auth.Token)
			app.Get("/panic", func(fiber.Ctx) error { panic("PRIVATE_PANIC_SENTINEL") })
			app.Get("/status/:code", func(c fiber.Ctx) error {
				code := fiber.StatusInternalServerError
				fmt.Sscan(c.Params("code"), &code)
				return fiber.NewError(code)
			})
			var wg sync.WaitGroup
			for i := range 8 {
				wg.Go(func() {
					req := httptest.NewRequest("POST", "/token", strings.NewReader(`{"username":"PRIVATE_USERNAME_SENTINEL","password":"Password!123"}`))
					req.Header.Set("Content-Type", "application/json")
					id := fmt.Sprintf("request-%d", i)
					req.Header.Set("X-Request-ID", id)
					resp, err := app.Test(req)
					if err != nil {
						t.Error(err)
						return
					}
					defer resp.Body.Close()
					if resp.StatusCode != 200 || resp.Header.Get("X-Request-ID") != id {
						t.Errorf("nonfatal update changed result: %d / %s", resp.StatusCode, resp.Header.Get("X-Request-ID"))
					}
				})
			}
			wg.Wait()
			if err := db.Callback().Query().Before("gorm:query").Register("logging:query_failure", func(tx *gorm.DB) {
				if requestmeta.RequestID(tx.Statement.Context) == "fatal-request" {
					tx.Statement.Selects = []string{"missing_logging_column"}
				}
			}); err != nil {
				t.Fatal(err)
			}
			fatalReq := httptest.NewRequest("POST", "/token", strings.NewReader(`{"username":"PRIVATE_USERNAME_SENTINEL","password":"Password!123"}`))
			fatalReq.Header.Set("Content-Type", "application/json")
			fatalReq.Header.Set("X-Request-ID", "fatal-request")
			fatalResp, err := app.Test(fatalReq)
			if err != nil {
				t.Fatal(err)
			}
			var fatalBody map[string]any
			if err := json.UnmarshalRead(fatalResp.Body, &fatalBody); err != nil {
				t.Fatal(err)
			}
			_ = fatalResp.Body.Close()
			if fatalResp.StatusCode != 500 || fatalBody["code"] != float64(500002) || fatalBody["request_id"] != "fatal-request" {
				t.Fatalf("fatal error contract: status=%d body=%+v", fatalResp.StatusCode, fatalBody)
			}

			for _, path := range []string{"/status/401", "/status/403", "/status/409", "/status/500", "/panic", "/missing"} {
				resp, err := app.Test(httptest.NewRequest("GET", path, nil))
				if err != nil {
					t.Fatal(err)
				}
				var body map[string]any
				if err := json.UnmarshalRead(resp.Body, &body); err != nil {
					t.Fatal(err)
				}
				_ = resp.Body.Close()
				if body["request_id"] == "" || body["request_id"] != resp.Header.Get("X-Request-ID") {
					t.Fatalf("error ID mismatch: %+v", body)
				}
			}
			longReq := httptest.NewRequest("GET", "/missing", nil)
			longReq.Header.Set("X-Request-ID", strings.Repeat("a", 129))
			resp, err := app.Test(longReq)
			if err != nil {
				t.Fatal(err)
			}
			_ = resp.Body.Close()
			if len(resp.Header.Get("X-Request-ID")) > 128 || resp.Header.Get("X-Request-ID") == "" {
				t.Fatal("long ID not replaced")
			}
			preflight := httptest.NewRequest("OPTIONS", "/token", nil)
			preflight.Header.Set("Origin", "https://example.test")
			preflight.Header.Set("Access-Control-Request-Method", "POST")
			resp, err = app.Test(preflight)
			if err != nil {
				t.Fatal(err)
			}
			_ = resp.Body.Close()
			if resp.StatusCode != 204 {
				t.Fatalf("preflight %d", resp.StatusCode)
			}
			// Actual SELECT/driver error fields must never contain parameter/panic text.
			perRequest := map[string]map[string]int{}
			fatalSQL, fatalAccess := 0, 0
			for _, name := range []string{"app.log", "sql.log"} {
				data, err := os.ReadFile(filepath.Join(logs.Directory, name))
				if err != nil {
					t.Fatal(err)
				}
				for _, secret := range []string{"PRIVATE_USERNAME_SENTINEL", "PRIVATE_DRIVER_SENTINEL", "PRIVATE_PANIC_SENTINEL", "Password!123", string(hash)} {
					if strings.Contains(string(data), secret) {
						t.Fatalf("%s leaked %s", name, secret)
					}
				}
				for line := range strings.SplitSeq(strings.TrimSpace(string(data)), "\n") {
					var row map[string]any
					if err := json.Unmarshal([]byte(line), &row); err != nil {
						t.Fatal(err)
					}
					id, _ := row["request_id"].(string)
					if id == "fatal-request" {
						if row["event"] == "db.query_failed" {
							fatalSQL++
						}
						if row["category"] == "access" {
							fatalAccess++
						}
					}
					if !strings.HasPrefix(id, "request-") {
						continue
					}
					if perRequest[id] == nil {
						perRequest[id] = map[string]int{}
					}
					category := row["category"].(string)
					perRequest[id][category]++
					if category == "app" && row["event"] != "auth.last_login_update_failed" {
						t.Fatalf("unexpected service event: %+v", row)
					}
				}
			}
			if fatalSQL != 1 || fatalAccess != 1 {
				t.Fatalf("fatal request logs: sql=%d access=%d", fatalSQL, fatalAccess)
			}
			if len(perRequest) != 8 {
				t.Fatalf("missing requests: %+v", perRequest)
			}
			for id, categories := range perRequest {
				if categories["access"] != 1 || categories["app"] != 1 || categories["sql"] < 1 {
					t.Fatalf("%s missing/duplicate events: %+v", id, categories)
				}
			}
		})
	}
}
