package bootstrap

import (
	"context"

	"github.com/casbin/casbin/v3"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/gofiber/fiber/v3/middleware/responsetime"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
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

	authRepo := repository.NewAuthRepository(app.Redis)
	authSvc := service.NewAuthService(app.Config, userRepo, authRepo)
	userSvc := service.NewUserService(userRepo)
	roleSvc := service.NewRoleService(roleRepo, permRepo, enforcer)

	authHandler := handler.NewAuthHandler(app.Config, authSvc)
	userHandler := handler.NewUserHandler(userSvc, userRepo)
	roleHandler := handler.NewRoleHandler(roleSvc, roleRepo, permRepo)

	// 4. 自动种子数据预热
	seedInitialData(app, userRepo, roleRepo, permRepo, enforcer)

	// 5. 路由注册
	api := fiberApp.Group("/api/v1")

	// 健康检查
	api.Get("/health", func(c fiber.Ctx) error {
		return response.Success(c, fiber.Map{
			"status":  "ok",
			"app":     app.Config.App.Name,
			"env":     app.Config.App.Env,
			"storage": app.Config.Storage.Driver,
		})
	})

	// 公开路由 (无需认证)
	authPublic := api.Group("/auth")
	authPublic.Post("/login", middleware.TrustedOrigin(app.Config.Security.TrustedOrigins), middleware.LoginRateLimit(app.Config.Security.LoginRateLimit), authHandler.Login)
	authPublic.Post("/token", middleware.LoginRateLimit(app.Config.Security.LoginRateLimit), authHandler.Token)
	authPublic.Post("/refresh", authHandler.Refresh)

	// 保护路由组 (挂载双通道认证与 Casbin 权限中间件)
	authRequired := api.Group("", middleware.DualAuth(authSvc, app.Config))

	// 个人信息与会话注销
	authRequired.Use(middleware.TrustedOrigin(app.Config.Security.TrustedOrigins))
	authRequired.Post("/auth/logout", authHandler.Logout)
	authRequired.Get("/auth/me", authHandler.Me)

	// 实时推送通知
	authRequired.Get("/sse/notifications", handler.StreamNotifications)

	// 业务管理路由组 (受 Casbin RBAC 管控)
	rbacGroup := authRequired.Group("", middleware.CasbinRBAC(enforcer))

	// 用户管理
	users := rbacGroup.Group("/users")
	users.Get("", userHandler.List)
	users.Post("", userHandler.Create)
	users.Get("/:id", userHandler.GetByID)
	users.Put("/:id", userHandler.Update)
	users.Patch("/:id/status", userHandler.ToggleStatus)
	users.Delete("/:id", userHandler.Delete)
	users.Put("/me/preferences", userHandler.UpdateMyPreferences)

	// 角色与权限管理
	roles := rbacGroup.Group("/roles")
	roles.Get("", roleHandler.List)
	roles.Post("", roleHandler.Create)
	roles.Get("/:id", roleHandler.GetByID)
	roles.Put("/:id", roleHandler.Update)
	roles.Delete("/:id", roleHandler.Delete)
	roles.Post("/:id/permissions", roleHandler.AssignPermissions)

	// 权限菜单树
	rbacGroup.Get("/permissions", roleHandler.GetPermissionTree)

	return fiberApp
}

func seedInitialData(app *AppContainer, userRepo domain.UserRepository, roleRepo domain.RoleRepository, permRepo domain.PermissionRepository, enforcer *casbin.Enforcer) {
	ctx := context.Background()

	// 1. 确保初始化管理员角色
	adminRole, err := roleRepo.GetByCode(ctx, "admin")
	if err != nil || adminRole == nil {
		role := domain.Role{
			Code:        "admin",
			Name:        "超级管理员",
			Description: "拥有平台所有最高管理权限",
			Status:      1,
		}
		_ = roleRepo.Create(ctx, &role)
		adminRole = &role
		app.Logger.Info("Seeded default admin role")
	}

	// 2. 确保初始化管理员账号
	adminUser, err := userRepo.GetByUsername(ctx, "admin")
	if err != nil || adminUser == nil {
		hashPassword, _ := bcrypt.GenerateFromPassword([]byte("admin123456"), bcrypt.DefaultCost)
		user := domain.User{
			Username: "admin",
			Email:    "admin@infranexus.com",
			Password: string(hashPassword),
			Nickname: "系统管理员",
			Status:   1,
		}
		if err := userRepo.Create(ctx, &user); err == nil {
			_ = userRepo.AssignRoles(ctx, user.ID, []uuid.UUID{adminRole.ID})
			app.Logger.Info("Seeded default admin user (admin / admin123456)")
		}
	}
}
