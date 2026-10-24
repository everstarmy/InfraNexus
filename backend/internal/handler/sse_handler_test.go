package handler

import (
	"bufio"
	"bytes"
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/valyala/fasthttp"

	"infranexus/internal/domain"
)

type lifecycleSSEStore struct {
	started   chan struct{}
	cancelled chan struct{}
	startOnce sync.Once
}

func (*lifecycleSSEStore) Publish(context.Context, string, any) error { return nil }
func (*lifecycleSSEStore) LatestID(context.Context) (string, error)   { return "123-0", nil }
func (s *lifecycleSSEStore) Read(ctx context.Context, _ string, _ time.Duration, _ int) ([]domain.RealtimeEvent, bool, error) {
	s.startOnce.Do(func() { close(s.started) })
	<-ctx.Done()
	close(s.cancelled)
	return nil, false, ctx.Err()
}

func TestWriteSSERejectsMetadataAndPayloadInjection(t *testing.T) {
	for name, testCase := range map[string]struct {
		id    string
		event string
		data  []byte
	}{
		"event newline":   {id: "1-0", event: "safe\nevent: injected", data: []byte(`{}`)},
		"id newline":      {id: "1-0\ndata: injected", event: "safe", data: []byte(`{}`)},
		"payload newline": {id: "1-0", event: "safe", data: []byte("{}\nevent: injected")},
	} {
		t.Run(name, func(t *testing.T) {
			var output bytes.Buffer
			if err := writeSSE(bufio.NewWriter(&output), testCase.id, testCase.event, testCase.data); err == nil {
				t.Fatal("writeSSE() accepted injected event data")
			}
			if strings.Contains(output.String(), "event: injected") {
				t.Fatalf("injected event reached stream: %q", output.String())
			}
		})
	}

	var output bytes.Buffer
	writer := bufio.NewWriter(&output)
	if err := writeSSE(writer, "123-0", "ldap.sync.progress", []byte(`{"completed":1}`)); err != nil {
		t.Fatalf("writeSSE() rejected valid JSON event: %v", err)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "id: 123-0\nevent: ldap.sync.progress\ndata: {\"completed\":1}") {
		t.Fatalf("valid event encoding = %q", output.String())
	}

	output.Reset()
	if err := writeSSE(writer, "124-0", "ldap.sync.progress", []byte("{\n  \"completed\": 2\n}")); err != nil {
		t.Fatalf("writeSSE() rejected indented JSON: %v", err)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	if got := output.String(); got != "id: 124-0\nevent: ldap.sync.progress\ndata: {\"completed\":2}\n\n" {
		t.Fatalf("indented payload was not compacted onto one data line: %q", got)
	}
}

func TestSSEStreamStopsAndClosesSocketOnApplicationCancellation(t *testing.T) {
	store := &lifecycleSSEStore{started: make(chan struct{}), cancelled: make(chan struct{})}
	lifecycle, cancelLifecycle := context.WithCancel(t.Context())
	app := fiber.New()
	stream := NewSSEHandler(store, nil, nil, nil, lifecycle)
	app.Get("/api/v1/sse/notifications", func(c fiber.Ctx) error {
		c.Locals("current_principal", &domain.Principal{UserID: uuid.New(), Username: "sse-test"})
		return stream.StreamNotifications(c)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serverErr := make(chan error, 1)
	go func() { serverErr <- app.Listener(listener) }()
	t.Cleanup(func() {
		cancelLifecycle()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = app.ShutdownWithContext(shutdownCtx)
	})

	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + listener.Addr().String() + "/api/v1/sse/notifications")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	var connected strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read connected event: %v", err)
		}
		connected.WriteString(line)
		if line == "\r\n" || line == "\n" {
			break
		}
	}
	if !strings.Contains(connected.String(), "event: connected") || !strings.Contains(connected.String(), "id: 123-0") {
		t.Fatalf("connected event did not establish its resume cursor: %q", connected.String())
	}
	select {
	case <-store.started:
	case <-time.After(time.Second):
		t.Fatal("SSE handler did not start its event read")
	}
	cancelLifecycle()
	select {
	case <-store.cancelled:
	case <-time.After(time.Second):
		t.Fatal("SSE event read did not stop when the application lifecycle was cancelled")
	}
	readResult := make(chan error, 1)
	go func() {
		for {
			_, err := reader.ReadString('\n')
			if err != nil {
				readResult <- err
				return
			}
		}
	}()
	select {
	case err := <-readResult:
		if err == nil {
			t.Fatal("stream remained open after application cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("SSE client socket remained open after application cancellation")
	}
}

// fasthttp closes the response body after a socket write fails. That close must
// cancel a Redis read immediately, even while the application remains running.
func TestSSEBodyCloseCancelsPendingRead(t *testing.T) {
	store := &lifecycleSSEStore{started: make(chan struct{}), cancelled: make(chan struct{})}
	life, cancel := context.WithCancel(t.Context())
	defer cancel()
	app := fiber.New()
	c := app.AcquireCtx(&fasthttp.RequestCtx{})
	defer app.ReleaseCtx(c)
	c.Locals("current_principal", &domain.Principal{UserID: uuid.New()})
	stream := NewSSEHandler(store, nil, nil, nil, life)
	if err := stream.StreamNotifications(c); err != nil {
		t.Fatal(err)
	}
	select {
	case <-store.started:
	case <-time.After(time.Second):
		t.Fatal("stream read did not start")
	}
	if err := c.Response().CloseBodyStream(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-store.cancelled:
	case <-time.After(time.Second):
		t.Fatal("closing the response body did not cancel its pending Redis read")
	}
	if life.Err() != nil {
		t.Fatal("body close cancelled application lifecycle")
	}
}
