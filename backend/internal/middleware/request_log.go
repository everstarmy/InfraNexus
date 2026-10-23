package middleware

import (
	"context"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/logger"
	"infranexus/internal/core/requestmeta"
)

func RequestIDFromContext(ctx context.Context) string {
	return requestmeta.RequestID(ctx)
}

// RequestID bounds client-supplied IDs before the official Fiber middleware
// stores them, keeping FromContext(c), response headers and service logs equal.
func RequestID() fiber.Handler {
	official := requestid.New()
	return func(c fiber.Ctx) error {
		if len(c.Get(fiber.HeaderXRequestID)) > 128 {
			c.Request().Header.Del(fiber.HeaderXRequestID)
		}
		return official(c)
	}
}

// RequestLogger 使用标准库 slog 记录结构化 HTTP 请求链路日志
func RequestLogger(log *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		reqID := requestid.FromContext(c)
		c.SetContext(requestmeta.WithRequestID(c.Context(), reqID))

		err := c.Next()

		latency := time.Since(start)
		status := c.Response().StatusCode()
		classification := coreerrors.Classification{}
		if err != nil {
			classification = coreerrors.Classify(err)
			status = classification.HTTPStatus
		}

		attrs := []any{
			slog.String("request_id", reqID),
			slog.String("method", c.Method()),
			slog.String("route", requestRoute(c)),
			slog.String("category", "access"),
			slog.String("component", "http"),
			slog.String("event", "http.request_completed"),
			slog.Int("status", status),
			slog.Float64("duration_ms", float64(latency)/float64(time.Millisecond)),
			slog.String("ip", c.IP()),
		}

		if status >= 500 {
			if err != nil {
				attrs = appendErrorAttrs(attrs, err, classification)
			}
			log.ErrorContext(c.Context(), "HTTP Server Error", attrs...)
		} else if status >= 400 {
			if err != nil {
				attrs = appendErrorAttrs(attrs, err, classification)
			}
			log.WarnContext(c.Context(), "HTTP Client Warning", attrs...)
		} else {
			log.InfoContext(c.Context(), "HTTP Request Handled", attrs...)
		}

		return err
	}
}

func appendErrorAttrs(attrs []any, err error, classification coreerrors.Classification) []any {
	attrs = append(attrs, "business_code", int(classification.BizCode))
	if classification.Cause != nil {
		attrs = append(attrs, logger.SafeError(classification.Cause)...)
	} else {
		attrs = append(attrs, logger.SafeError(err)...)
	}
	return attrs
}

func requestRoute(c fiber.Ctx) string {
	if route := c.Route(); route != nil && route.Path != "" && route.Method != "USE" {
		return route.Path
	}
	return "<unmatched>"
}
