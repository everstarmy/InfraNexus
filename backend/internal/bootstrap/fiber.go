package bootstrap

import (
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/gofiber/fiber/v3/middleware/responsetime"

	"infranexus/internal/core/errors"
	"infranexus/internal/handler"
	"infranexus/internal/middleware"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

func NewFiberApp(app *AppContainer) *fiber.App {
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
		app.Logger.Warn("Casbin enforcer init with warning, fallback", "error", err)
	}

	// 3. 数据访问层与业务逻辑层组装 (Dependency Injection)
	userRepo := repository.NewUserRepository(app.DB)
	roleRepo := repository.NewRoleRepository(app.DB)
	permRepo := repository.NewPermissionRepository(app.DB)

	deptRepo := repository.NewDepartmentRepository(app.DB)

	authRepo := repository.NewAuthRepository(app.Redis)
	authSvc := service.NewAuthService(app.Config, userRepo, authRepo)
	userSvc := service.NewUserService(userRepo, roleRepo, deptRepo)
	roleSvc := service.NewRoleService(roleRepo, permRepo, enforcer)
	permSvc := service.NewPermissionService(permRepo)
	deptSvc := service.NewDepartmentService(deptRepo, userRepo)

	registerRoutes(fiberApp, routeDeps{
		cfg:         app.Config,
		authSvc:     authSvc,
		enforcer:    enforcer,
		auth:        handler.NewAuthHandler(app.Config, authSvc),
		users:       handler.NewUserHandler(userSvc),
		roles:       handler.NewRoleHandler(roleSvc, permSvc),
		departments: handler.NewDepartmentHandler(deptSvc),
		options:     handler.NewOptionsHandler(roleSvc, deptSvc),
	})

	return fiberApp
}
