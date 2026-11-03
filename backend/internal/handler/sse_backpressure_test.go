package handler

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"infranexus/internal/domain"
)

// stalledWriteConn provides a deterministic TCP backpressure barrier. Closing
// the connection must release Write even when the application writer is stuck.
type stalledWriteConn struct {
	net.Conn
	entered, closed, exited chan struct{}
	once                    sync.Once
	bytes                   int
}

func (c *stalledWriteConn) Write(p []byte) (int, error) {
	c.bytes += len(p)
	if c.bytes > 64*1024 {
		close(c.entered)
		<-c.closed
		defer close(c.exited)
	}
	return c.Conn.Write(p)
}
func (c *stalledWriteConn) Close() error {
	c.once.Do(func() { close(c.closed) })
	return c.Conn.Close()
}

type stalledListener struct {
	net.Listener
	entered, closed, exited chan struct{}
}

func (l stalledListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &stalledWriteConn{Conn: conn, entered: l.entered, closed: l.closed, exited: l.exited}, nil
}

type backpressureStore struct {
	domain.SSEEventStore
	payload []byte
}

func (*backpressureStore) LatestID(context.Context) (string, error) { return "1-0", nil }
func (s *backpressureStore) Read(context.Context, string, time.Duration, int) ([]domain.RealtimeEvent, bool, error) {
	return []domain.RealtimeEvent{{ID: "1-1", Name: "test.payload", Data: s.payload}}, false, nil
}
func TestSSECancellationReleasesBackpressuredSocketWriter(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	app := fiber.New()
	store := &backpressureStore{payload: []byte(`"` + strings.Repeat("x", 2*1024*1024) + `"`)}
	stream := NewSSEHandler(store, nil, nil, nil, ctx)
	app.Get("/events", func(c fiber.Ctx) error {
		c.Locals("current_principal", &domain.Principal{UserID: uuid.New()})
		return stream.StreamNotifications(c)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	gate := stalledListener{Listener: listener, entered: make(chan struct{}), closed: make(chan struct{}), exited: make(chan struct{})}
	go func() { _ = app.Listener(gate) }()
	t.Cleanup(func() {
		cancel()
		shutdown, cancelShutdown := context.WithTimeout(context.Background(), time.Second)
		defer cancelShutdown()
		_ = app.ShutdownWithContext(shutdown)
	})
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := io.WriteString(conn, "GET /events HTTP/1.1\r\nHost: localhost\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	// The client deliberately stops consuming the body after receiving headers.
	select {
	case <-gate.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("writer never reached backpressure barrier")
	}
	cancel()
	select {
	case <-gate.exited:
	case <-time.After(time.Second):
		t.Fatal("application cancellation did not release blocked socket write")
	}
	shutdown, cancelShutdown := context.WithTimeout(t.Context(), time.Second)
	defer cancelShutdown()
	if err := app.ShutdownWithContext(shutdown); err != nil {
		t.Fatalf("server retained backpressured connection: %v", err)
	}
}

type unavailableSSEStore struct{ domain.SSEEventStore }

func (unavailableSSEStore) LatestID(context.Context) (string, error) { return "1-0", nil }
func (unavailableSSEStore) Read(context.Context, string, time.Duration, int) ([]domain.RealtimeEvent, bool, error) {
	return nil, false, errors.New("injected Redis read failure")
}
func TestSSEEventStoreFailureClosesSocket(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	app := fiber.New()
	stream := NewSSEHandler(unavailableSSEStore{}, nil, nil, nil, ctx)
	app.Get("/events", func(c fiber.Ctx) error {
		c.Locals("current_principal", &domain.Principal{UserID: uuid.New()})
		return stream.StreamNotifications(c)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = app.Listener(listener) }()
	t.Cleanup(func() {
		cancel()
		shutdown, finish := context.WithTimeout(context.Background(), time.Second)
		defer finish()
		_ = app.ShutdownWithContext(shutdown)
	})
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://" + listener.Addr().String() + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || !strings.Contains(string(body), "event: connected") {
		t.Fatalf("stream did not close cleanly after storage failure: body=%q err=%v", body, err)
	}
}
