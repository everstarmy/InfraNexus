package middleware

import (
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
)

// RequestLogger 使用标准库 slog 记录结构化 HTTP 请求链路日志
func RequestLogger(log *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		reqID, _ := c.Locals("requestid").(string)

		err := c.Next()

		latency := time.Since(start)
		status := c.Response().StatusCode()

		attrs := []any{
			slog.String("request_id", reqID),
			slog.String("method", c.Method()),
			slog.String("path", c.Path()),
			slog.Int("status", status),
			slog.Duration("latency", latency),
			slog.String("ip", c.IP()),
		}

		if status >= 500 {
			log.Error("HTTP Server Error", attrs...)
		} else if status >= 400 {
			log.Warn("HTTP Client Warning", attrs...)
		} else {
			log.Info("HTTP Request Handled", attrs...)
		}

		return err
	}
}
