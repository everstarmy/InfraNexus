package logger

import (
	"context"
	"log/slog"
	"os"
)

type ctxKey string

const RequestIDKey ctxKey = "request_id"

var globalLogger *slog.Logger

func Init(debug bool) *slog.Logger {
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}

	opts := &slog.HandlerOptions{
		Level:     level,
		AddSource: debug,
	}

	var handler slog.Handler
	if debug {
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}

	globalLogger = slog.New(handler)
	slog.SetDefault(globalLogger)
	return globalLogger
}

func L() *slog.Logger {
	if globalLogger == nil {
		return Init(true)
	}
	return globalLogger
}

// WithContext 从 context 提取 request_id 绑定结构化属性
func WithContext(ctx context.Context) *slog.Logger {
	l := L()
	if ctx == nil {
		return l
	}
	if reqID, ok := ctx.Value(RequestIDKey).(string); ok && reqID != "" {
		return l.With(slog.String("request_id", reqID))
	}
	return l
}
