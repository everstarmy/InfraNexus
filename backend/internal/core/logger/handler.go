package logger

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"infranexus/internal/config"
	"infranexus/internal/core/requestmeta"
)

const maxEventBytes = 16 * 1024

type handler struct {
	settings config.LoggingConfig
	app, env string
	sink     *outputs
	attrs    []slog.Attr
	groups   []string
}

var _ slog.Handler = (*handler)(nil)

func appLevel(value string) slog.Level {
	switch value {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func (h *handler) Enabled(_ context.Context, level slog.Level) bool {
	minimum := appLevel(h.settings.Level)
	if h.settings.SQL.Enabled && h.settings.SQL.Level != "silent" {
		sqlMin := slog.LevelInfo
		if h.settings.SQL.Level == "warn" {
			sqlMin = slog.LevelWarn
		}
		if h.settings.SQL.Level == "error" {
			sqlMin = slog.LevelError
		}
		minimum = min(minimum, sqlMin)
	}
	return level >= minimum
}

func grouped(attrs []slog.Attr, groups []string) []slog.Attr {
	for i := len(groups) - 1; i >= 0; i-- {
		attrs = []slog.Attr{slog.GroupAttrs(groups[i], attrs...)}
	}
	return attrs
}

func (h *handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	copy := *h
	copy.attrs = append(slices.Clone(h.attrs), grouped(slices.Clone(attrs), h.groups)...)
	return &copy
}
func (h *handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	copy := *h
	copy.groups = append(slices.Clone(h.groups), name)
	return &copy
}

// mergeAttrs merges repeated groups and keys so each JSON object has unique keys.
func mergeAttrs(dst []slog.Attr, attrs ...slog.Attr) []slog.Attr {
	for _, a := range attrs {
		a.Value = a.Value.Resolve()
		if a.Equal(slog.Attr{}) {
			continue
		}
		if a.Value.Kind() == slog.KindGroup {
			children := mergeAttrs(nil, a.Value.Group()...)
			if a.Key == "" {
				dst = mergeAttrs(dst, children...)
				continue
			}
			if len(children) == 0 {
				continue
			}
			a = slog.GroupAttrs(a.Key, children...)
		}
		idx := slices.IndexFunc(dst, func(old slog.Attr) bool { return old.Key == a.Key })
		if idx < 0 {
			dst = append(dst, a)
			continue
		}
		if dst[idx].Value.Kind() == slog.KindGroup && a.Value.Kind() == slog.KindGroup {
			a = slog.GroupAttrs(a.Key, mergeAttrs(slices.Clone(dst[idx].Value.Group()), a.Value.Group()...)...)
		}
		dst[idx] = a
	}
	return dst
}

func truncate(value string, limit int) string {
	value = strings.ToValidUTF8(value, "�")
	if len(value) <= limit {
		return value
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value + "…"
}

func safeAttr(a slog.Attr) slog.Attr {
	a.Value = a.Value.Resolve()
	key := strings.ToLower(a.Key)
	// Prevent accidental explicit secret fields and unreviewed error text.
	switch key {
	case "password", "bind_password", "token", "access_token", "refresh_token", "authorization", "cookie", "set-cookie", "dsn", "secret", "encryption_key":
		return slog.String(a.Key, "[REDACTED]")
	}
	switch a.Value.Kind() {
	case slog.KindGroup:
		children := a.Value.Group()
		out := make([]slog.Attr, 0, min(len(children), 32))
		for _, child := range children[:min(len(children), 32)] {
			out = append(out, safeAttr(child))
		}
		return slog.GroupAttrs(truncate(a.Key, 64), out...)
	case slog.KindString:
		limit := 1024
		if key == "sql" {
			limit = 4096
		}
		a.Value = slog.StringValue(truncate(a.Value.String(), limit))
	case slog.KindAny:
		if err, ok := a.Value.Any().(error); ok {
			a.Value = slog.StringValue(fmt.Sprintf("%T", err))
		} else {
			// Typed IDs and small scalar values retain useful text; composite values
			// are represented by type to avoid dumping request/configuration bodies.
			switch value := a.Value.Any().(type) {
			case fmt.Stringer:
				a.Value = slog.StringValue(truncate(value.String(), 1024))
			case nil:
				a.Value = slog.StringValue("")
			default:
				a.Value = slog.StringValue(fmt.Sprintf("%T", value))
			}
		}
	}
	a.Key = truncate(a.Key, 64)
	return a
}

func (h *handler) Handle(ctx context.Context, record slog.Record) error {
	attrs := mergeAttrs(nil, h.attrs...)
	var current []slog.Attr
	record.Attrs(func(a slog.Attr) bool { current = append(current, a); return true })
	attrs = mergeAttrs(attrs, grouped(current, h.groups)...)
	// Context fields stay at the top level, including after WithGroup.
	for _, field := range []struct{ key, value string }{
		{"request_id", requestmeta.RequestID(ctx)}, {"task_id", requestmeta.TaskID(ctx)}, {"operator_id", requestmeta.OperatorID(ctx)},
	} {
		if field.value != "" {
			attrs = mergeAttrs(attrs, slog.String(field.key, field.value))
		}
	}
	category := "app"
	for _, a := range attrs {
		if a.Key == "category" && a.Value.Kind() == slog.KindString {
			category = a.Value.String()
		}
	}
	minimum := appLevel(h.settings.Level)
	if category == "sql" {
		if !h.settings.SQL.Enabled || h.settings.SQL.Level == "silent" {
			return nil
		}
		minimum = appLevel(h.settings.SQL.Level)
	}
	if record.Level < minimum {
		return nil
	}
	attrs = mergeAttrs(attrs, slog.String("app", h.app), slog.String("env", h.env), slog.String("category", category))
	// Schema defaults keep older call sites usable during migration.
	hasComponent, hasEvent := false, false
	for _, a := range attrs {
		hasComponent = hasComponent || a.Key == "component"
		hasEvent = hasEvent || a.Key == "event"
	}
	if !hasComponent {
		attrs = append(attrs, slog.String("component", "application"))
	}
	if !hasEvent {
		attrs = append(attrs, slog.String("event", "app.message"))
	}
	clean := make([]slog.Attr, 0, len(attrs))
	for _, a := range attrs {
		switch a.Key {
		case "time", "level", "msg", "source":
			continue
		}
		clean = append(clean, safeAttr(a))
	}
	r := slog.NewRecord(record.Time.UTC(), record.Level, truncate(record.Message, 512), record.PC)
	r.AddAttrs(clean...)
	var data bytes.Buffer
	render := func(r slog.Record) error {
		opts := &slog.HandlerOptions{Level: slog.LevelDebug, AddSource: h.settings.AddSource}
		var out slog.Handler = slog.NewJSONHandler(&data, opts)
		if h.settings.Format == "text" {
			out = slog.NewTextHandler(&data, opts)
		}
		return out.Handle(ctx, r)
	}
	if err := render(r); err != nil {
		return err
	}
	if data.Len() > maxEventBytes {
		data.Reset()
		r = slog.NewRecord(record.Time.UTC(), record.Level, "Log event exceeded size limit", record.PC)
		for _, a := range clean {
			switch a.Key {
			case "app", "env", "category", "component", "event", "request_id", "task_id", "operator_id":
				if a.Value.Kind() == slog.KindString {
					r.AddAttrs(slog.String(a.Key, truncate(a.Value.String(), 128)))
				}
			}
		}
		r.AddAttrs(slog.Bool("truncated", true))
		if err := render(r); err != nil {
			return err
		}
	}
	h.sink.write(category, data.Bytes())
	return nil
}

func (o *outputs) write(category string, data []byte) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return
	}
	file := o.app
	if category == "sql" {
		file = o.sql
	}
	failed := false
	for _, out := range []interface{ Write([]byte) (int, error) }{o.stdout, file} {
		if out == nil {
			continue
		}
		n, err := out.Write(data)
		if err != nil || n != len(data) {
			failed = true
		}
	}
	now := time.Now().Unix()
	if failed && (o.lastDiagnostic == 0 || now-o.lastDiagnostic >= 60) {
		o.lastDiagnostic = now
		if o.diagnostic != nil {
			_, _ = fmt.Fprintln(o.diagnostic, `{"level":"ERROR","event":"logging.write_failed","msg":"Log output failed; some events may be lost"}`)
		}
	}
}
