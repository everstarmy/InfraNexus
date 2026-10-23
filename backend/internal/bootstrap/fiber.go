package bootstrap

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/responsetime"
	"github.com/valyala/fasthttp"

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
		WriteTimeout: 30 * time.Second,
	})
	fiberApp.Server().HeaderReceived = func(header *fasthttp.RequestHeader) fasthttp.RequestConfig {
		if strings.HasPrefix(string(header.RequestURI()), "/api/v1/sse/notifications") {
			// SSE connections are deliberately rotated after two minutes. The
			// client resumes from Last-Event-ID, while a stalled socket is bounded.
			return fasthttp.RequestConfig{WriteTimeout: handler.SSEConnectionMaxLifetime}
		}
		return fasthttp.RequestConfig{}
	}
	fiberApp.Server().CloseOnShutdown = true
	fiberApp.Hooks().OnPreShutdown(func() error {
		app.cancelLifecycle()
		return nil
	})

	// 1. 全局中间件流水线
	fiberApp.Use(middleware.RequestID())
	fiberApp.Use(middleware.RequestLogger(app.Logger))
	fiberApp.Use(recover.New(recover.Config{PanicHandler: func(_ fiber.Ctx, _ any) error { return fiber.ErrInternalServerError }}))
	fiberApp.Use(responsetime.New())
	fiberApp.Use(cors.New(cors.Config{
		AllowOrigins:     app.Config.Security.TrustedOrigins,
		AllowCredentials: true,
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-Id"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
	}))

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
	organization := repository.NewOrganizationUnitOfWork(app.DB)

	ldapRepo := repository.NewLDAPRepository(app.DB)

	authRepo := repository.NewAuthRepository(app.Redis)
	authzState := repository.NewAuthorizationStateRepository(app.DB)
	authzNotifier := repository.NewRedisAuthorizationNotifier(app.Redis)
	authzSvc := service.NewAuthorizationService(enforcer, roleRepo, permRepo, authzState, authzNotifier, app.Logger)
	app.AddBackground(authzSvc.Run)
	eventStore := repository.NewRedisEventStore(app.Redis)
	ldapSvc := service.NewLDAPService(service.LDAPServiceDeps{
		Repo:         ldapRepo,
		Users:        userRepo,
		Roles:        roleRepo,
		Departments:  deptRepo,
		Organization: organization,
		Gateway:      repository.NewLDAPGateway(),
		Cipher:       app.Cipher,
		Events:       eventStore,
		Logger:       app.Logger,
	})
	app.OnClose(ldapSvc.Close)
	if scheduler := app.Config.Directory.Scheduler; scheduler.Enabled {
		tick := time.Duration(scheduler.TickSeconds) * time.Second
		if tick <= 0 {
			tick = time.Minute
		}
		app.AddBackground(func(ctx context.Context) {
			service.RunDirectoryScheduler(ctx, ldapSvc, tick, app.Logger)
		})
	}
	authSvc := service.NewAuthService(app.Config, userRepo, authRepo, authzSvc, ldapSvc, app.Logger)
	userSvc := service.NewUserService(userRepo, roleRepo, deptRepo, organization, authzSvc)
	roleSvc := service.NewRoleService(roleRepo, permRepo, authzSvc)
	permSvc := service.NewPermissionService(permRepo, authzSvc, func() ([]domain.RouteInfo, error) { return discoverAPIRoutes(fiberApp) })
	deptSvc := service.NewDepartmentService(deptRepo, userRepo, organization)

	registerRoutes(fiberApp, routeDeps{
		cfg:     app.Config,
		authSvc: authSvc,
		casbin: middleware.NewCasbin(middleware.CasbinConfig{
			Enforcer:  enforcer,
			Authorize: authzSvc.Enforce,
			SuperRole: domain.AdminRoleCode,
		}),
		auth:        handler.NewAuthHandler(app.Config, authSvc),
		users:       handler.NewUserHandler(userSvc, authSvc),
		roles:       handler.NewRoleHandler(roleSvc),
		permissions: handler.NewPermissionHandler(permSvc),
		sse:         handler.NewSSEHandler(eventStore, authSvc, authzSvc, app.Logger, app.lifecycleContext()),
		departments: handler.NewDepartmentHandler(deptSvc),
		options:     handler.NewOptionsHandler(roleSvc, deptSvc),
		ldap:        handler.NewLDAPHandler(ldapSvc),
		dashboard:   handler.NewDashboardHandler(service.NewDashboardService(userRepo, deptRepo, roleRepo, permRepo, ldapRepo)),
	})
	if _, err := discoverAPIRoutes(fiberApp); err != nil {
		return nil, fmt.Errorf("validate API route access classes: %w", err)
	}

	if _, _, err := authzSvc.SyncAllPolicies(context.Background()); err != nil {
		return nil, fmt.Errorf("sync casbin policies: %w", err)
	}

	return fiberApp, nil
}
