package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoggingDefaultsAndEnvironment(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte("app:\n  debug: true\n  env: development\n"), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.Logging.Level != "debug" || c.Logging.SQL.Level != "info" || c.Logging.Format != "text" {
		t.Fatalf("defaults: %+v", c.Logging)
	}
	t.Setenv("APP_APP_ENV", "production")
	t.Setenv("APP_LOGGING_LEVEL", "error")
	t.Setenv("APP_LOGGING_ADD_SOURCE", "false")
	t.Setenv("APP_LOGGING_SQL_ENABLED", "false")
	t.Setenv("APP_LOGGING_SQL_SLOW_THRESHOLD_MS", "0")
	t.Setenv("APP_LOGGING_FILE_COMPRESS", "false")
	c, err = LoadConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.Logging.Format != "json" || c.Logging.Level != "error" || c.Logging.AddSource || c.Logging.SQL.Enabled || c.Logging.SQL.SlowThresholdMS != 0 || c.Logging.File.Compress {
		t.Fatalf("environment overrides: %+v", c.Logging)
	}
	t.Setenv("APP_LOGGING_FILE_MAX_SIZE_MB", "0")
	if _, err := LoadConfig(dir); err == nil {
		t.Fatal("explicit zero size must fail")
	}
}

func TestLoggingYAMLAndInvalidValues(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	for _, value := range []string{"format: xml", "output: remote", "level: verbose", "sql:\n    level: debug", "sql:\n    slow_threshold_ms: -1", "file:\n    max_backups: 0"} {
		if err := os.WriteFile(path, []byte("app:\n  debug: false\nlogging:\n  "+value+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadConfig(dir); err == nil {
			t.Fatalf("accepted %s", value)
		}
	}
	if err := os.WriteFile(path, []byte("logging:\n  level: warn\n  sql:\n    enabled: false\n"), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.Logging.Level != "warn" || c.Logging.SQL.Enabled {
		t.Fatalf("YAML not applied: %+v", c.Logging)
	}
}
