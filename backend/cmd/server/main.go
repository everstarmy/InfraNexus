package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"infranexus/internal/bootstrap"
	"infranexus/internal/config"
	"infranexus/internal/core/logger"
	"infranexus/internal/domain"
)

func main() {
	// 1. 初始化 Viper 集中配置
	cfg := config.MustLoad()

	// 2. 初始化 slog 结构化日志
	log := logger.Init(cfg.App.Debug)
	log.Info("Starting InfraNexus Platform Server", "app", cfg.App.Name, "env", cfg.App.Env, "port", cfg.App.Port)

	// 3. 构建依赖注入上下文 (DB, Redis, Storage)
	container, err := bootstrap.NewAppContainer(cfg, log)
	if err != nil {
		log.Error("Failed to initialize application container", "error", err)
		os.Exit(1)
	}
	defer container.Close()

	// 4. 自动数据库表结构迁移 (兼容 SQLite 与 PostgreSQL)
	if err := container.DB.AutoMigrate(
		&domain.User{},
		&domain.Role{},
		&domain.Permission{},
	); err != nil {
		log.Error("Database automigration failed", "error", err)
		os.Exit(1)
	}

	// 5. 装配 GoFiber v3 引擎 (全局中间件 + 路由)
	fiberApp := bootstrap.NewFiberApp(container)

	// 6. 优雅启动与平滑退出 (Graceful Shutdown)
	go func() {
		addr := ":" + cfg.App.Port
		log.Info("InfraNexus HTTP engine listening", "address", addr)
		if err := fiberApp.Listen(addr); err != nil {
			log.Error("Fiber server listen failed", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("Shutting down InfraNexus server gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := fiberApp.ShutdownWithContext(ctx); err != nil {
		log.Error("Server forced to shutdown", "error", err)
	}
	log.Info("InfraNexus server exited cleanly.")
}
