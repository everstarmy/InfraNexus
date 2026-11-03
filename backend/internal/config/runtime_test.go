package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRuntimeEnvironmentAndProxyValidation(t *testing.T) {
	for _, env := range []string{"production", "test", "development", "prodution", "", "Production"} {
		cfg := Config{App: AppConfig{Env: env}}
		valid := env == "production" || env == "test" || env == "development"
		if err := cfg.ValidateRuntime(); (err == nil) != valid {
			t.Fatalf("environment %q accepted=%v", env, err == nil)
		}
	}
	for _, proxy := range []string{"127.0.0.1", "172.30.248.0/28", "::1", "*", "localhost", ""} {
		cfg := Config{App: AppConfig{Env: "test"}, Security: SecurityConfig{TrustedProxies: []string{proxy}}}
		valid := proxy == "127.0.0.1" || proxy == "172.30.248.0/28" || proxy == "::1"
		if err := cfg.ValidateRuntime(); (err == nil) != valid {
			t.Fatalf("proxy %q accepted=%v", proxy, err == nil)
		}
	}
}

func TestRuntimeEnvironmentAndLifetimesFromEnvironment(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte("app:\n  env: development\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadConfig(dir); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"APP_APP_ENV", "APP_SESSION_MAX_AGE", "APP_SESSION_ABSOLUTE_MAX_AGE", "APP_JWT_ACCESS_TOKEN_EXPIRE", "APP_JWT_REFRESH_TOKEN_EXPIRE"} {
		t.Run(key, func(t *testing.T) {
			value := "0"
			if key == "APP_APP_ENV" {
				value = "prodution"
			}
			t.Setenv(key, value)
			if _, err := LoadConfig(dir); err == nil {
				t.Fatalf("accepted invalid %s", key)
			}
		})
	}
}
