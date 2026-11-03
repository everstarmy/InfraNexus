package logger

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/mattn/go-sqlite3"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"infranexus/internal/config"
	"infranexus/internal/core/requestmeta"
)

type gormLog struct {
	base     *slog.Logger
	settings config.SQLLogConfig
	driver   string
	level    gormlogger.LogLevel
}

var _ gormlogger.Interface = (*gormLog)(nil)
var _ gorm.ParamsFilter = (*gormLog)(nil)

func NewGORM(base *slog.Logger, settings config.SQLLogConfig, driver string) gormlogger.Interface {
	level := gormlogger.Warn
	switch settings.Level {
	case "silent":
		level = gormlogger.Silent
	case "error":
		level = gormlogger.Error
	case "info":
		level = gormlogger.Info
	}
	return &gormLog{base: base, settings: settings, driver: driver, level: level}
}

func (l *gormLog) LogMode(level gormlogger.LogLevel) gormlogger.Interface {
	copy := *l
	copy.level = level
	return &copy
}

// ParamsFilter must be implemented by the outermost logger: GORM checks this
// interface before Dialector.Explain. Binding values never enter a SQL log.
func (l *gormLog) ParamsFilter(_ context.Context, sql string, _ ...any) (string, []any) {
	return sql, nil
}

func (l *gormLog) emit(ctx context.Context, level slog.Level, event string, attrs ...any) {
	if !l.settings.Enabled || l.level == gormlogger.Silent {
		return
	}
	fields := []any{"category", "sql", "component", "gorm", "event", event, "db_driver", l.driver}
	if id := requestmeta.RequestID(ctx); id != "" {
		fields = append(fields, "request_id", id)
	}
	fields = append(fields, attrs...)
	l.base.Log(ctx, level, "Database operation", fields...)
}

// GORM startup callbacks may supply DSNs in format arguments. Keep only a
// stable event, not the message or arguments from the driver.
func (l *gormLog) Info(ctx context.Context, _ string, _ ...any) {
	if l.level >= gormlogger.Info {
		l.emit(ctx, slog.LevelInfo, "db.info")
	}
}
func (l *gormLog) Warn(ctx context.Context, _ string, _ ...any) {
	if l.level >= gormlogger.Warn {
		l.emit(ctx, slog.LevelWarn, "db.warning")
	}
}
func (l *gormLog) Error(ctx context.Context, _ string, _ ...any) {
	if l.level >= gormlogger.Error {
		l.emit(ctx, slog.LevelError, "db.error")
	}
}

var pgPlaceholder = regexp.MustCompile(`\$[0-9]+`)
var literalSQL = regexp.MustCompile(`'|--|/\*|\b[0-9]+\b`)

func (l *gormLog) Trace(ctx context.Context, begin time.Time, query func() (string, int64), err error) {
	if !l.settings.Enabled || l.level == gormlogger.Silent {
		return
	}
	elapsed := time.Since(begin)
	slow := l.settings.SlowThresholdMS > 0 && elapsed > time.Duration(l.settings.SlowThresholdMS)*time.Millisecond
	level, event := slog.LevelInfo, "db.query"
	switch {
	case err != nil && !errors.Is(err, gorm.ErrRecordNotFound) && l.level >= gormlogger.Error:
		level, event = slog.LevelError, "db.query_failed"
	case slow && l.level >= gormlogger.Warn:
		level, event = slog.LevelWarn, "db.slow_query"
	case l.level >= gormlogger.Info:
	default:
		return
	}
	if !l.base.Enabled(ctx, level) {
		return
	}
	sql, rows := query()
	// Only explicitly marked background polls may be quiet. Empty request
	// queries, unknown row counts, slow polls and errors retain their logs.
	if level == slog.LevelInfo && err == nil && !slow && rows == 0 &&
		requestmeta.IsSQLPoll(ctx) && requestmeta.RequestID(ctx) == "" {
		return
	}
	attrs := []any{"duration_ms", float64(elapsed) / float64(time.Millisecond), "slow", slow}
	// Bound parameters are filtered earlier. Conservatively omit statements with
	// inline literals/comments instead of promising a general SQL redactor.
	if literalSQL.MatchString(pgPlaceholder.ReplaceAllString(sql, "?")) || strings.Contains(sql, "$$") {
		attrs = append(attrs, "sql_omitted", true)
	} else {
		attrs = append(attrs, "sql", truncate(sql, l.settings.MaxSQLLength))
	}
	if rows >= 0 {
		attrs = append(attrs, "rows", rows)
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		attrs = append(attrs, SafeError(err)...)
	}
	l.emit(ctx, level, event, attrs...)
}

// SafeError returns useful classification without rendering error messages,
// driver detail/hint, bound values, credentials, or connection strings.
func SafeError(err error) []any {
	if err == nil {
		return nil
	}
	attrs := []any{"error_type", fmt.Sprintf("%T", err)}
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok {
		attrs = append(attrs, "db_code", pg.Code)
	}
	if sqlite, ok := errors.AsType[sqlite3.Error](err); ok {
		attrs = append(attrs, "db_code", int(sqlite.ExtendedCode))
	}
	return attrs
}
