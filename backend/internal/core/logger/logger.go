// Package logger provides structured, request-aware application and SQL logs.
package logger

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"gopkg.in/natefinch/lumberjack.v2"

	"infranexus/internal/config"
	"infranexus/internal/core/requestmeta"
)

// Runtime owns file outputs. It never closes stdout or stderr.
type Runtime struct {
	Logger    *slog.Logger
	Directory string
	sink      *outputs
	files     []*lumberjack.Logger
	once      sync.Once
	closeErr  error
}

func New(cfg *config.Config) (*Runtime, error) {
	c := cfg.EffectiveLogging()
	if err := c.Validate(); err != nil {
		return nil, err
	}
	r := &Runtime{}
	sink := &outputs{stdout: os.Stdout, diagnostic: os.Stderr}
	if c.Output != "stdout" {
		directory, err := filepath.Abs(c.File.Directory)
		if err != nil {
			return nil, fmt.Errorf("resolve log directory: %w", err)
		}
		if err := os.MkdirAll(directory, 0750); err != nil {
			return nil, fmt.Errorf("create log directory: %w", err)
		}
		r.Directory = directory
		for _, name := range []string{"app.log", "sql.log"} {
			path := filepath.Join(directory, name)
			// Preflight lazy lumberjack outputs before accepting requests. Existing
			// files are normalized to the documented 0640 mode.
			f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0640)
			if err != nil {
				_ = r.Close()
				return nil, fmt.Errorf("open %s: %w", name, err)
			}
			chmodErr := f.Chmod(0640)
			err = errors.Join(chmodErr, f.Close())
			if err != nil {
				_ = r.Close()
				return nil, fmt.Errorf("prepare %s: %w", name, err)
			}
			file := &lumberjack.Logger{Filename: path, MaxSize: c.File.MaxSizeMB, MaxBackups: c.File.MaxBackups, MaxAge: c.File.MaxAgeDays, Compress: c.File.Compress}
			r.files = append(r.files, file)
		}
		sink.app, sink.sql = r.files[0], r.files[1]
	}
	if c.Output == "file" {
		sink.stdout = nil
	}
	r.sink = sink
	r.Logger = slog.New(&handler{settings: c, app: cfg.App.Name, env: cfg.App.Env, sink: sink})
	return r, nil
}

func (r *Runtime) Close() error {
	r.once.Do(func() {
		if r.sink != nil {
			r.sink.mu.Lock()
			defer r.sink.mu.Unlock()
			r.sink.closed = true
		}
		for _, f := range r.files {
			r.closeErr = errors.Join(r.closeErr, f.Close())
		}
	})
	return r.closeErr
}

// Init preserves the development entry point; production uses New and Close.
func Init(debug bool) *slog.Logger {
	r, err := New(&config.Config{App: config.AppConfig{Debug: debug}})
	if err != nil {
		panic(err)
	} // Built-in stdout defaults are always valid.
	slog.SetDefault(r.Logger)
	return r.Logger
}

func L() *slog.Logger { return slog.Default() }

// WithContext is retained for callers that cannot use Context log methods.
// New Context log methods should use the injected logger directly.
func WithContext(ctx context.Context) *slog.Logger {
	l := L()
	if id := requestmeta.RequestID(ctx); id != "" {
		l = l.With("request_id", id)
	}
	return l
}

// outputs serializes complete events, tries every configured destination, and
// reports failures out of band without recursively logging or panicking.
type outputs struct {
	closed           bool
	mu               sync.Mutex
	stdout, app, sql io.Writer
	diagnostic       io.Writer
	lastDiagnostic   int64
}
