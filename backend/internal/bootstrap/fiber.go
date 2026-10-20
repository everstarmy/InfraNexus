package bootstrap

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/gofiber/fiber/v3/middleware/responsetime"

	"infranexus/internal/core/errors"
	"infranexus/internal/domain"
	"infranexus/internal/handler"
	"infranexus/internal/middleware"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

func NewFiberApp(app *AppContainer) (*fiber.App, error) {
	fiberApp := fiber.New(fiber.Config{
		AppName:      app.Config.App.Name,
		ErrorHandler: errors.GlobalErrorHandler,
	})

	// 1. 全局中间件流水线
	fiberApp.Use(recover.New())
	fiberApp.Use(requestid.New())
	fiberApp.Use(responsetime.New())
	fiberApp.Use(cors.New(cors.Config{
		AllowOrigins:     app.Config.Security.TrustedOrigins,
		AllowCredentials: true,
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-Id"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
	}))
	fiberApp.Use(middleware.RequestLogger(app.Logger))

	// 2. 初始化 Casbin Enforcer
	enforcer, err := InitCasbin(app.DB, app.Logger)
	if err != nil {
		return nil, err
	}

	// 3. 数据访问层与业务逻辑层组装 (Dependency Injection)
	userRepo := repository.NewUserRepository(app.DB)
	roleRepo := repository.NewRoleRepository(app.DB)
	permRepo := repository.NewPermissionRepository(app.DB)

	deptRepo := repository.NewDepartmentRepository(app.DB)

	authRepo := repository.NewAuthRepository(app.Redis)
	authzSvc := service.NewAuthorizationService(enforcer, roleRepo, permRepo)
	authSvc := service.NewAuthService(app.Config, userRepo, authRepo, authzSvc)
	userSvc := service.NewUserService(userRepo, roleRepo, deptRepo)
	roleSvc := service.NewRoleService(roleRepo, authzSvc)
	permSvc := service.NewPermissionService(permRepo, authzSvc, func() []domain.RouteInfo { return discoverAPIRoutes(fiberApp) })
	deptSvc := service.NewDepartmentService(deptRepo, userRepo)

	registerRoutes(fiberApp, routeDeps{
		cfg:         app.Config,
		authSvc:     authSvc,
		casbin:      middleware.NewCasbin(middleware.CasbinConfig{Enforcer: enforcer, SuperRole: domain.AdminRoleCode}),
		auth:        handler.NewAuthHandler(app.Config, authSvc),
		users:       handler.NewUserHandler(userSvc),
		roles:       handler.NewRoleHandler(roleSvc),
		permissions: handler.NewPermissionHandler(permSvc),
		departments: handler.NewDepartmentHandler(deptSvc),
		options:     handler.NewOptionsHandler(roleSvc, deptSvc),
	})

	if _, _, err := authzSvc.SyncAllPolicies(context.Background()); err != nil {
		return nil, fmt.Errorf("sync casbin policies: %w", err)
	}

	return fiberApp, nil
}
