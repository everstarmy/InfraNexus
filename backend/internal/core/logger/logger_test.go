package logger

import (
	"bytes"
	"compress/gzip"
	"encoding/json/v2"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"infranexus/internal/config"
	"infranexus/internal/core/requestmeta"
)

func testLogger(out io.Writer, settings config.LoggingConfig) *slog.Logger {
	return slog.New(&handler{settings: settings, app: "test", env: "test", sink: &outputs{stdout: out}})
}

func records(t *testing.T, data []byte) []map[string]any {
	t.Helper()
	var result []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(string(data)), "\n") {
		if line == "" {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			t.Fatalf("invalid JSON: %v: %s", err, line)
		}
		result = append(result, value)
	}
	return result
}

func TestContextGroupsAndConcurrency(t *testing.T) {
	var out bytes.Buffer
	log := testLogger(&out, config.DefaultLogging(false, "test"))
	log = log.With("component", "test").With("request_id", "old").WithGroup("business").With("one", 1).With("two", 2)
	var wg sync.WaitGroup
	for i := range 24 {
		wg.Go(func() {
			ctx := requestmeta.WithRequestID(t.Context(), strconv.Itoa(i))
			ctx = requestmeta.WithTask(ctx, "task-"+strconv.Itoa(i), "operator")
			log.WarnContext(ctx, "degraded", "event", "test.degraded", "error", errors.New("SECRET_SENTINEL"))
		})
	}
	wg.Wait()
	seen := map[string]bool{}
	for _, record := range records(t, out.Bytes()) {
		id := record["request_id"].(string)
		if seen[id] || record["task_id"] != "task-"+id || record["operator_id"] != "operator" {
			t.Fatalf("metadata cross-talk: %+v", record)
		}
		seen[id] = true
		business := record["business"].(map[string]any)
		if business["one"] != float64(1) || business["two"] != float64(2) {
			t.Fatalf("WithAttrs lost: %+v", record)
		}
	}
	if len(seen) != 24 || strings.Contains(out.String(), "SECRET_SENTINEL") {
		t.Fatal("lost or unsafe events")
	}
	out.Reset()
	testLogger(&out, config.DefaultLogging(false, "test")).Info("background")
	if _, ok := records(t, out.Bytes())[0]["request_id"]; ok {
		t.Fatal("fabricated request ID")
	}
}

func TestIndependentLevelsAndBoundedEvent(t *testing.T) {
	var out bytes.Buffer
	c := config.DefaultLogging(false, "test")
	c.Level, c.SQL.Level = "error", "info"
	log := testLogger(&out, c)
	log.Info("suppressed app")
	log.Info("SQL", "category", "sql", "sql", "SELECT ?")
	if got := records(t, out.Bytes()); len(got) != 1 || got[0]["category"] != "sql" {
		t.Fatalf("SQL filtered by app level: %+v", got)
	}
	out.Reset()
	var attrs []any
	for i := range 64 {
		attrs = append(attrs, strconv.Itoa(i), strings.Repeat("\x01", 1024))
	}
	log.ErrorContext(requestmeta.WithRequestID(t.Context(), "size-test"), "oversize", attrs...)
	if out.Len() > maxEventBytes {
		t.Fatalf("event too large: %d", out.Len())
	}
	got := records(t, out.Bytes())[0]
	if got["truncated"] != true || got["request_id"] != "size-test" {
		t.Fatalf("invalid bounded event: %+v", got)
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("sensitive filesystem error") }
func TestOutputFailureTriesOtherDestinations(t *testing.T) {
	var file, diag bytes.Buffer
	sink := &outputs{stdout: failingWriter{}, app: &file, diagnostic: &diag}
	sink.write("app", []byte("first\n"))
	sink.write("app", []byte("second\n"))
	if file.String() != "first\nsecond\n" || strings.Count(diag.String(), "logging.write_failed") != 1 || strings.Contains(diag.String(), "sensitive") {
		t.Fatalf("output failure handling: %q / %q", file.String(), diag.String())
	}
}

func TestFileRoutingRotationAndPermissions(t *testing.T) {
	c := &config.Config{Logging: config.DefaultLogging(false, "test")}
	c.Logging.Output = "file"
	c.Logging.File.Directory = t.TempDir()
	c.Logging.File.MaxSizeMB, c.Logging.File.MaxBackups = 1, 2
	c.Logging.SQL.Level = "info"
	r, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 1300 {
		r.Logger.Info("rotate", "sequence", i, "padding", strings.Repeat("x", 1000))
	}
	r.Logger.Info("sql-only", "category", "sql", "sql", "SELECT ?")
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"app.log", "sql.log"} {
		path := filepath.Join(r.Directory, name)
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0640 {
			t.Fatalf("mode %s: %o", name, info.Mode().Perm())
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		records(t, data)
		if (name == "app.log" && bytes.Contains(data, []byte("sql-only"))) || (name == "sql.log" && bytes.Contains(data, []byte("rotate"))) {
			t.Fatalf("wrong routing %s", name)
		}
	}
	// Lumberjack compresses backups asynchronously. Wait only for observable
	// completion; the loop does not invent elapsed-time success.
	deadline := time.Now().Add(5 * time.Second)
	for {
		files, _ := filepath.Glob(filepath.Join(r.Directory, "app-*.gz"))
		if len(files) > 0 {
			f, err := os.Open(files[0])
			if err != nil {
				t.Fatal(err)
			}
			z, err := gzip.NewReader(f)
			if err == nil {
				data, readErr := io.ReadAll(z)
				_ = z.Close()
				_ = f.Close()
				if readErr == nil {
					records(t, data)
					break
				}
			} else {
				_ = f.Close()
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("no complete compressed backup")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestInitializationFailureAndStdoutNoDirectory(t *testing.T) {
	c := &config.Config{Logging: config.DefaultLogging(false, "test")}
	c.Logging.File.Directory = filepath.Join(t.TempDir(), "absent")
	r, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	_ = r.Close()
	if _, err := os.Stat(c.Logging.File.Directory); !os.IsNotExist(err) {
		t.Fatal("stdout created log directory")
	}
	c.Logging.Output = "file"
	if err := os.WriteFile(c.Logging.File.Directory, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(c); err == nil {
		t.Fatal("accepted non-directory log path")
	}
}

func TestSafeAttributes(t *testing.T) {
	var out bytes.Buffer
	log := testLogger(&out, config.DefaultLogging(false, "test"))
	log.Error("test", "password", "secret", "nested", slog.GroupValue(slog.String("token", "secret")), "error", errors.New("secret"))
	if strings.Contains(out.String(), "secret") {
		t.Fatal(out.String())
	}
	if !utf8Valid(truncate(strings.Repeat("中", 100), 5)) {
		t.Fatal("invalid UTF8")
	}
}
func utf8Valid(s string) bool { return strings.ToValidUTF8(s, "?") == s }

func TestBackupCountAndAgeCleanup(t *testing.T) {
	c := &config.Config{Logging: config.DefaultLogging(false, "test")}
	c.Logging.Output = "file"
	c.Logging.File.Directory = t.TempDir()
	c.Logging.File.MaxBackups = 2
	c.Logging.File.MaxAgeDays = 1
	c.Logging.File.Compress = false
	old := filepath.Join(c.Logging.File.Directory, "app-2000-01-01T00-00-00.000.log")
	if err := os.WriteFile(old, []byte("old"), 0640); err != nil {
		t.Fatal(err)
	}
	for i := range 4 {
		name := "app-" + time.Now().UTC().Add(-time.Duration(i+1)*time.Minute).Format("2006-01-02T15-04-05.000") + ".log"
		if err := os.WriteFile(filepath.Join(c.Logging.File.Directory, name), []byte("backup"), 0640); err != nil {
			t.Fatal(err)
		}
	}
	r, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	r.Logger.Info("cleanup trigger")
	deadline := time.Now().Add(5 * time.Second)
	for {
		files, _ := filepath.Glob(filepath.Join(r.Directory, "app-*.log"))
		_, oldErr := os.Stat(old)
		if len(files) == 2 && os.IsNotExist(oldErr) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("retention not enforced: %v", files)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
