package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/bootstrap"
	"infranexus/internal/config"
	"infranexus/internal/core/logger"
)

func main() {
	if err := run(); err != nil {
		// Do not render configuration/driver error text before a safe logger exists.
		stage := "runtime"
		if startup, ok := errors.AsType[*startupError](err); ok {
			stage = startup.stage
		}
		_, _ = fmt.Fprintf(os.Stderr, "{\"level\":\"ERROR\",\"event\":\"app.exit_failed\",\"stage\":%q,\"msg\":\"Server exited with an error\"}\n", stage)
		os.Exit(1)
	}
}

func run() (result error) {
	// 1. 初始化 Viper 集中配置
	cfg, err := config.LoadConfig()
	if err != nil {
		return &startupError{stage: "configuration", cause: err}
	}

	// 2. 初始化 slog 结构化日志
	logs, err := logger.New(cfg)
	if err != nil {
		return &startupError{stage: "logging", cause: err}
	}
	log := logs.Logger.With("component", "server")
	slog.SetDefault(log)
	defer func() {
		if result != nil {
			log.Error("Server exited with an error", append([]any{"event", "app.stopped_failed"}, logger.SafeError(result)...)...)
		} else {
			log.Info("InfraNexus server exited cleanly", "event", "app.stopped")
		}
		if err := logs.Close(); err != nil {
			_, _ = fmt.Fprintln(os.Stderr, `{"level":"ERROR","event":"logging.close_failed"}`)
		}
	}()
	if logs.Directory != "" {
		log.Info("Log file output initialized", "event", "logging.files_opened", "directory", logs.Directory)
	}
	log.Info("Starting InfraNexus Platform Server", "app", cfg.App.Name, "env", cfg.App.Env, "port", cfg.App.Port)

	// 3. 构建依赖注入上下文 (DB, Redis, Storage)
	container, err := bootstrap.NewAppContainer(cfg, log)
	if err != nil {
		return err
	}
	defer container.Close()

	// 4. 自动数据库表结构迁移 (兼容 SQLite 与 PostgreSQL)
	if err := bootstrap.Migrate(container.DB); err != nil {
		return err
	}
	if err := bootstrap.Seed(container.DB, log); err != nil {
		return err
	}
	if len(os.Args) > 1 && (os.Args[1] == "bootstrap-admin" || os.Args[1] == "rotate-admin-password") {
		password := os.Getenv("INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD")
		var commandErr error
		if os.Args[1] == "bootstrap-admin" {
			commandErr = bootstrap.BootstrapAdmin(container.DB, password, log)
		} else {
			commandErr = bootstrap.RotateBootstrapAdminPassword(container.DB, password)
		}
		if commandErr != nil {
			return commandErr
		}
		log.Info("Administrator credential operation completed", "command", os.Args[1])
		return nil
	}

	// 5. 装配 GoFiber v3 引擎 (全局中间件 + 路由)
	fiberApp, err := bootstrap.NewFiberApp(container)
	if err != nil {
		return err
	}
	container.StartBackground()

	// A bind failure must wake main instead of leaving it waiting for a signal.
	listenErr := make(chan error, 1)
	go func() {
		addr := ":" + cfg.App.Port
		log.Info("InfraNexus HTTP engine listening", "event", "app.listening", "address", addr)
		listenErr <- fiberApp.Listen(addr, fiber.ListenConfig{DisableStartupMessage: true})
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(quit)
	select {
	case <-quit:
	case result = <-listenErr:
	}
	log.Info("Shutting down InfraNexus server", "event", "app.stopping")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return errors.Join(result, fiberApp.ShutdownWithContext(ctx))
}

// startupError exposes a safe stage while retaining the original error chain.
type startupError struct {
	stage string
	cause error
}

func (e *startupError) Error() string { return "startup failed at " + e.stage }
func (e *startupError) Unwrap() error { return e.cause }
