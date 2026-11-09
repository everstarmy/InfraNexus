package main

import (
	"bytes"
	"encoding/json/v2"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"infranexus/internal/core/secret"
)

// Exercise main in a child process to verify both managed logs and the final
// stderr diagnostic, including the actual nonzero process exit.
func TestStartupFailureProcess(t *testing.T) {
	if os.Getenv("INFRANEXUS_TEST_STARTUP_FAILURE") == "1" {
		os.Args = os.Args[:1]
		if argument := os.Getenv("INFRANEXUS_TEST_SERVER_ARGUMENT"); argument != "" {
			os.Args = append(os.Args, argument)
		}
		main()
		return
	}
	configData, err := os.ReadFile("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, key, jwt, stage, reason, hint string
	}{
		{"short encryption key", "SHORT_X9", strings.Repeat("JWT_SENTINEL_", 4), "encryption", "encryption_key_too_short", "at least 16 bytes"},
		{"default encryption key", secret.DevKey, strings.Repeat("JWT_SENTINEL_", 4), "encryption", "encryption_key_missing_or_default", "non-default value"},
		{"invalid JWT", strings.Repeat("KEY_SENTINEL_", 4), "SHORT_J9", "jwt", "jwt_secret_invalid", "at least 32 bytes"},
		{"database initialization", strings.Repeat("KEY_SENTINEL_", 4), strings.Repeat("JWT_SENTINEL_", 4), "database", "database_initialization_failed", "database configuration"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "config.yaml"), configData, 0o600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(os.Args[0], "-test.run=^TestStartupFailureProcess$")
			cmd.Dir = dir
			for _, value := range os.Environ() {
				if !strings.HasPrefix(value, "APP_") && !strings.HasPrefix(value, "INFRANEXUS_TEST_STARTUP_FAILURE=") {
					cmd.Env = append(cmd.Env, value)
				}
			}
			cmd.Env = append(cmd.Env, "INFRANEXUS_TEST_STARTUP_FAILURE=1", "APP_APP_ENV=production", "APP_DATABASE_DSN=postgres://test:DB_SENTINEL@localhost:invalid/infranexus", "APP_LOGGING_FORMAT=json", "APP_LOGGING_OUTPUT=stdout", "APP_LOGGING_LEVEL=info", "APP_SECURITY_ENCRYPTION_KEY="+tc.key, "APP_JWT_SECRET="+tc.jwt)
			output, err := cmd.CombinedOutput()
			if exit, ok := errors.AsType[*exec.ExitError](err); !ok || exit.ExitCode() != 1 {
				t.Fatalf("expected exit 1, got %v", err)
			}
			for _, value := range []string{tc.key, tc.jwt, "DB_SENTINEL"} {
				if bytes.Contains(output, []byte(value)) {
					t.Fatal("startup output leaked credential sentinel")
				}
			}
			found := map[string]bool{}
			for line := range bytes.SplitSeq(bytes.TrimSpace(output), []byte("\n")) {
				var entry map[string]any
				if err := json.Unmarshal(line, &entry); err != nil {
					t.Fatalf("invalid JSON log: %v", err)
				}
				event, _ := entry["event"].(string)
				if event != "app.stopped_failed" && event != "app.exit_failed" {
					continue
				}
				found[event] = true
				if entry["stage"] != tc.stage || entry["reason"] != tc.reason || !strings.Contains(fmt.Sprint(entry["hint"]), tc.hint) {
					t.Fatalf("unexpected safe diagnostic: %v", entry)
				}
			}
			if !found["app.stopped_failed"] || !found["app.exit_failed"] {
				t.Fatal("missing managed or stderr diagnostic")
			}
		})
	}
}

func TestStartupFailureDoesNotRenderUnknownError(t *testing.T) {
	var output bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&output, nil))
	logStartupFailure(log, fmt.Errorf("driver: %w", errors.New("PASSWORD_DSN_SENTINEL")))
	if strings.Contains(output.String(), "PASSWORD_DSN_SENTINEL") {
		t.Fatal("raw driver error leaked")
	}
	if !strings.Contains(output.String(), `"reason":"runtime_failed"`) {
		t.Fatal("missing fallback diagnostic")
	}
}

func TestRemovedBootstrapCommandIsRejected(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestStartupFailureProcess$")
	cmd.Dir = t.TempDir() // Rejection must not require config or touch the database.
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "INFRANEXUS_TEST_STARTUP_FAILURE=") && !strings.HasPrefix(entry, "INFRANEXUS_TEST_SERVER_ARGUMENT=") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "INFRANEXUS_TEST_STARTUP_FAILURE=1", "INFRANEXUS_TEST_SERVER_ARGUMENT=bootstrap-admin")
	output, err := cmd.CombinedOutput()
	if exit, ok := errors.AsType[*exec.ExitError](err); !ok || exit.ExitCode() != 1 {
		t.Fatalf("removed command must fail immediately, got %v", err)
	}
	var diagnostic map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(output), &diagnostic); err != nil {
		t.Fatal(err)
	}
	if diagnostic["stage"] != "arguments" || diagnostic["reason"] != "unsupported_command" {
		t.Fatalf("unexpected removed-command diagnostic: %v", diagnostic)
	}
}
