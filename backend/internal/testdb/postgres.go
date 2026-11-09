// Package testdb provisions isolated schemas for PostgreSQL integration tests.
package testdb

import (
	"context"
	"crypto/rand"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// DSN creates a schema and sets the search path for every pooled connection.
func DSN(t testing.TB) string {
	t.Helper()
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal("connect to isolated PostgreSQL test database")
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := admin.Close(ctx); err != nil {
			t.Error("close PostgreSQL test control connection")
		}
	})
	schema := "infranexus_test_" + strings.ToLower(rand.Text())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	})
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		conn, err := url.Parse(dsn)
		if err != nil {
			t.Fatal("parse PostgreSQL test URL")
		}
		query := conn.Query()
		query.Set("search_path", schema)
		conn.RawQuery = query.Encode()
		return conn.String()
	}
	return dsn + " search_path=" + schema
}

// Dialector opens a pool whose connections are all scoped to the test schema.
func Dialector(t testing.TB) gorm.Dialector {
	t.Helper()
	cfg, err := pgx.ParseConfig(DSN(t))
	if err != nil {
		t.Fatal("parse PostgreSQL test connection settings")
	}
	db := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { _ = db.Close() })
	return postgres.New(postgres.Config{Conn: db})
}
