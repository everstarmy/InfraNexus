package repository

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

func TestKeywordSearchIsLiteralAndCaseInsensitive(t *testing.T) {
	testKeywordSearch(t, sqlite.Open(filepath.Join(t.TempDir(), "keyword.db")))
}

func TestKeywordSearchIsLiteralAndCaseInsensitivePostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	testKeywordSearch(t, postgres.Open(dsn))
}

func testKeywordSearch(t *testing.T, driver gorm.Dialector) {
	t.Helper()
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Permission{}, &domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	// A unique marker keeps the assertions independent of rows left by other
	// suites in a shared disposable PostgreSQL database.
	marker := "kw" + uuid.NewString()[:8]
	users := NewUserRepository(db)
	for _, name := range []string{marker + "_Alpha", marker + "xalpha", marker + `\back`, marker + "%pct"} {
		user := &domain.User{Username: name, Email: name + "@example.test", Password: "hash", AuthType: domain.AuthTypeLocal, Status: domain.StatusEnabled}
		if err := users.Create(t.Context(), user); err != nil {
			t.Fatal(err)
		}
	}
	search := func(keyword string) []string {
		found, _, err := users.Search(t.Context(), domain.UserFilter{Keyword: keyword})
		if err != nil {
			t.Fatalf("Search(%q): %v", keyword, err)
		}
		names := make([]string, 0, len(found))
		for _, user := range found {
			names = append(names, user.Username)
		}
		return names
	}
	if got := search(marker + "_ALPHA"); len(got) != 1 || got[0] != marker+"_Alpha" {
		t.Fatalf("underscore must be literal and case-insensitive: %v", got)
	}
	if got := search(strings.ToUpper(marker) + "XALPHA"); len(got) != 1 {
		t.Fatalf("mixed-case keyword must match: %v", got)
	}
	if got := search(marker + "%"); len(got) != 1 || got[0] != marker+"%pct" {
		t.Fatalf("percent must be literal: %v", got)
	}
	if got := search(marker + `\b`); len(got) != 1 || got[0] != marker+`\back` {
		t.Fatalf("backslash must be literal: %v", got)
	}

	roles := NewRoleRepository(db)
	if err := roles.Create(t.Context(), &domain.Role{Code: marker + "_ops", Name: "Ops " + marker, Status: domain.StatusEnabled}); err != nil {
		t.Fatal(err)
	}
	if err := roles.Create(t.Context(), &domain.Role{Code: marker + "xops", Name: "Other " + marker, Status: domain.StatusEnabled}); err != nil {
		t.Fatal(err)
	}
	found, total, err := roles.Search(t.Context(), marker+"_OPS", 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(found) != 1 || found[0].Code != marker+"_ops" {
		t.Fatalf("role search must be literal and case-insensitive: total=%d %+v", total, found)
	}
}
