package middleware

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/requestmeta"
)

func RequestIDFromContext(ctx context.Context) string {
	return requestmeta.RequestID(ctx)
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
			slog.String("path", c.Path()),
			slog.Int("status", status),
			slog.Duration("latency", latency),
			slog.String("ip", c.IP()),
		}

		if status >= 500 {
			if err != nil {
				attrs = appendErrorAttrs(attrs, err, classification)
			}
			log.Error("HTTP Server Error", attrs...)
		} else if status >= 400 {
			if err != nil {
				attrs = appendErrorAttrs(attrs, err, classification)
			}
			log.Warn("HTTP Client Warning", attrs...)
		} else {
			log.Info("HTTP Request Handled", attrs...)
		}

		return err
	}
}

func appendErrorAttrs(attrs []any, err error, classification coreerrors.Classification) []any {
	attrs = append(attrs, slog.String("error_type", fmt.Sprintf("%T", err)), slog.Int("business_code", int(classification.BizCode)))
	if cause := classification.Cause; cause != nil {
		attrs = append(attrs, slog.String("cause_type", fmt.Sprintf("%T", cause)))
		// Database driver errors often interpolate key values into their message;
		// keep those structured by type while logging other internal causes directly.
		if !isDatabaseCause(cause) {
			attrs = append(attrs, slog.String("cause", cause.Error()))
		} else {
			attrs = append(attrs, slog.String("cause", "database operation failed"))
		}
	}
	return attrs
}

func isDatabaseCause(err error) bool {
	for err != nil {
		causeType := fmt.Sprintf("%T", err)
		if strings.Contains(causeType, "gorm") || strings.Contains(causeType, "pgconn") || strings.Contains(causeType, "sqlite") {
			return true
		}
		err = errors.Unwrap(err)
	}
	return false
}
