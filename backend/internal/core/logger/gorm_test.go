package logger

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"infranexus/internal/config"
	"infranexus/internal/core/requestmeta"
)

func TestGORMModesAndLazySQL(t *testing.T) {
	for _, test := range []struct {
		name    string
		mode    gormlogger.LogLevel
		err     error
		elapsed time.Duration
		want    string
	}{
		{"silent", gormlogger.Silent, errors.New("secret"), time.Second, ""},
		{"fast-warn", gormlogger.Warn, nil, 0, ""},
		{"error-only-slow", gormlogger.Error, nil, time.Second, ""},
		{"slow", gormlogger.Warn, nil, time.Second, "db.slow_query"},
		{"error", gormlogger.Error, errors.New("secret"), 0, "db.query_failed"},
		{"notfound", gormlogger.Warn, gorm.ErrRecordNotFound, 0, ""},
		{"slow-notfound", gormlogger.Warn, gorm.ErrRecordNotFound, time.Second, "db.slow_query"},
		{"info", gormlogger.Info, nil, 0, "db.query"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var out bytes.Buffer
			c := config.DefaultLogging(false, "test")
			c.SQL.Level = "info"
			log := testLogger(&out, c)
			base := NewGORM(log, c.SQL, "sqlite")
			l := base.LogMode(test.mode)
			calls := 0
			l.Trace(requestmeta.WithRequestID(t.Context(), "sql-request"), time.Now().Add(-test.elapsed), func() (string, int64) { calls++; return "SELECT ?", 1 }, test.err)
			if (out.Len() != 0) != (test.want != "") || calls != btoi(test.want != "") {
				t.Fatalf("output/callback: %s / %d", out.String(), calls)
			}
			if test.want != "" && (!strings.Contains(out.String(), test.want) || !strings.Contains(out.String(), "sql-request")) {
				t.Fatal(out.String())
			}
			if strings.Contains(out.String(), "secret") {
				t.Fatal("error leaked")
			}
			if base.(*gormLog).level != gormlogger.Info {
				t.Fatal("LogMode mutated original")
			}
		})
	}
}
func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}

func TestGORMDisabledAndLiteralSQL(t *testing.T) {
	var out bytes.Buffer
	c := config.DefaultLogging(false, "test")
	c.SQL.Level = "info"
	l := NewGORM(testLogger(&out, c), c.SQL, "postgres")
	l.Trace(t.Context(), time.Now(), func() (string, int64) { return "SELECT 'SECRET_SENTINEL'", 1 }, nil)
	if strings.Contains(out.String(), "SECRET_SENTINEL") || !strings.Contains(out.String(), "sql_omitted") {
		t.Fatal(out.String())
	}
	c.SQL.Enabled = false
	l = NewGORM(testLogger(&out, c), c.SQL, "postgres").LogMode(gormlogger.Info)
	l.Trace(t.Context(), time.Now(), func() (string, int64) { t.Fatal("disabled evaluated SQL"); return "", 0 }, errors.New("secret"))
	sql, params := l.(gorm.ParamsFilter).ParamsFilter(t.Context(), "SELECT $1", "secret")
	if sql != "SELECT $1" || len(params) != 0 {
		t.Fatal("parameters were not filtered")
	}
}

func TestGORMEmptyPollFiltering(t *testing.T) {
	for _, tc := range []struct {
		name            string
		marked, request bool
		rows            int64
		elapsed         time.Duration
		err             error
		want            string
	}{
		{name: "empty background poll", marked: true, rows: 0},
		{name: "ordinary empty query", rows: 0, want: "db.query"},
		{name: "request empty poll", marked: true, request: true, rows: 0, want: "db.query"},
		{name: "poll found work", marked: true, rows: 1, want: "db.query"},
		{name: "poll unknown row count", marked: true, rows: -1, want: "db.query"},
		{name: "slow empty poll", marked: true, rows: 0, elapsed: time.Second, want: "db.slow_query"},
		{name: "failed empty poll", marked: true, rows: 0, err: errors.New("private driver error"), want: "db.query_failed"},
		{name: "notfound poll", marked: true, rows: 0, err: gorm.ErrRecordNotFound, want: "db.query"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			c := config.DefaultLogging(true, "test")
			c.Format = "json"
			log := NewGORM(testLogger(&out, c), c.SQL, "sqlite")
			ctx := t.Context()
			if tc.marked {
				ctx = requestmeta.WithSQLPoll(ctx)
			}
			if tc.request {
				ctx = requestmeta.WithRequestID(ctx, "request")
			}
			calls := 0
			log.Trace(ctx, time.Now().Add(-tc.elapsed), func() (string, int64) { calls++; return "SELECT ?", tc.rows }, tc.err)
			if calls != 1 {
				t.Fatalf("row callback calls=%d", calls)
			}
			if tc.want == "" {
				if out.Len() != 0 {
					t.Fatalf("empty poll produced noise: %s", out.String())
				}
			} else if !strings.Contains(out.String(), tc.want) {
				t.Fatalf("missing %s: %s", tc.want, out.String())
			}
		})
	}
}
