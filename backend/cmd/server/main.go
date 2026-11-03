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
		stage, reason, hint := startupDiagnostic(err)
		_, _ = fmt.Fprintf(os.Stderr, "{\"level\":\"ERROR\",\"event\":\"app.exit_failed\",\"stage\":%q,\"reason\":%q,\"hint\":%q,\"msg\":\"Server exited with an error\"}\n", stage, reason, hint)
		os.Exit(1)
	}
}

func run() (result error) {
	if len(os.Args) > 1 && (len(os.Args) != 2 || os.Args[1] != "rotate-admin-password") {
		return &startupError{stage: "arguments", cause: errors.New("unsupported server command")}
	}

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
			logStartupFailure(log, result)
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
	if len(os.Args) > 1 {
		if err := bootstrap.RotateBootstrapAdminPassword(container.DB, os.Getenv("INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD")); err != nil {
			return err
		}
		log.Info("Administrator credential operation completed", "command", "rotate-admin-password")
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

// startupDiagnostic renders only fixed, reviewed diagnostics; never err.Error().
func startupDiagnostic(err error) (stage, reason, hint string) {
	if startup, ok := errors.AsType[*bootstrap.StartupError](err); ok {
		return startup.Stage, startup.Reason, startup.Error()
	}
	if startup, ok := errors.AsType[*startupError](err); ok {
		if startup.stage == "arguments" {
			return "arguments", "unsupported_command", "Start without arguments; password recovery uses rotate-admin-password"
		}
		return startup.stage, "startup_failed", "Check configuration and logging settings"
	}
	return "runtime", "runtime_failed", "Check application dependencies and runtime settings"
}

func logStartupFailure(log *slog.Logger, err error) {
	stage, reason, hint := startupDiagnostic(err)
	attrs := []any{"event", "app.stopped_failed", "stage", stage, "reason", reason, "hint", hint}
	log.Error("Server exited with an error", append(attrs, logger.SafeError(err)...)...)
}
