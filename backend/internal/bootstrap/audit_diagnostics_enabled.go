//go:build r09audit

package bootstrap

import (
	"bytes"
	"encoding/json/v2"
	"net"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

// StartAuditDiagnostics exposes resource counts only in explicitly tagged audit
// images. The Compose file publishes this port on host loopback, never the gateway.
func StartAuditDiagnostics(app *AppContainer) func() {
	log := app.Logger
	addr := os.Getenv("INFRANEXUS_AUDIT_ADDR")
	if addr == "" {
		return func() {}
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Error("Audit diagnostics listener failed", "error", err)
		return func() {}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /resources", func(w http.ResponseWriter, _ *http.Request) {
		stack := make([]byte, 4<<20)
		n := runtime.Stack(stack, true)
		fds, _ := os.ReadDir("/proc/self/fd")
		var memory runtime.MemStats
		runtime.ReadMemStats(&memory)
		established := 0
		for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
			data, _ := os.ReadFile(path)
			for line := range strings.SplitSeq(string(data), "\n") {
				fields := strings.Fields(line)
				if len(fields) > 3 && strings.HasSuffix(fields[1], ":1F90") && fields[3] == "01" {
					established++
				}
			}
		}
		poolTotal, poolIdle, pubsub := uint32(0), uint32(0), uint32(0)
		if app.Redis != nil {
			stats := app.Redis.PoolStats()
			poolTotal, poolIdle, pubsub = stats.TotalConns, stats.IdleConns, stats.PubSubStats.Active
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.MarshalWrite(w, map[string]any{
			"goroutines": runtime.NumGoroutine(), "fds": len(fds), "heap_bytes": memory.HeapAlloc,
			"sse_writers":    bytes.Count(stack[:n], []byte("(*SSEHandler).StreamNotifications.func")),
			"redis_readers":  bytes.Count(stack[:n], []byte("(*redisEventStore).Read(")),
			"stack_complete": n < len(stack), "app_tcp_established": established,
			"redis_pool_total": poolTotal, "redis_pool_idle": poolIdle, "redis_pubsub_active": pubsub,
		})
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 2 * time.Second, WriteTimeout: 5 * time.Second}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Error("Audit diagnostics stopped", "error", err)
		}
	}()
	return func() { _ = server.Close() }
}
