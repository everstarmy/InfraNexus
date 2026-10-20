package handler

import (
	"bufio"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/middleware"
)

type SSEEvent struct {
	Event string `json:"event"`
	Data  any    `json:"data"`
	Time  int64  `json:"time"`
}

type SSEHub struct {
	mu      sync.RWMutex
	clients map[chan SSEEvent]bool
}

var GlobalSSEHub = &SSEHub{
	clients: make(map[chan SSEEvent]bool),
}

func (h *SSEHub) Broadcast(event string, data any) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	e := SSEEvent{
		Event: event,
		Data:  data,
		Time:  time.Now().Unix(),
	}

	for ch := range h.clients {
		select {
		case ch <- e:
		default:
		}
	}
}

func (h *SSEHub) AddClient(ch chan SSEEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[ch] = true
}

func (h *SSEHub) RemoveClient(ch chan SSEEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, ch)
	close(ch)
}

// StreamNotifications Server-Sent Events 长连接实时事件推送端点
func StreamNotifications(c fiber.Ctx) error {
	userCtx, _ := c.Locals("current_user").(*middleware.UserContext)
	username := "guest"
	if userCtx != nil {
		username = userCtx.Username
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	ch := make(chan SSEEvent, 10)
	GlobalSSEHub.AddClient(ch)

	return c.SendStreamWriter(func(w *bufio.Writer) {
		defer GlobalSSEHub.RemoveClient(ch)

		// 发送初始连接成功事件
		initEvent, _ := json.Marshal(map[string]any{
			"message": "Connected to InfraNexus SSE channel",
			"user":    username,
		})
		_, _ = fmt.Fprintf(w, "event: connected\ndata: %s\n\n", initEvent)
		_ = w.Flush()

		ticker := time.NewTicker(25 * time.Second) // 心跳保活
		defer ticker.Stop()

		for {
			select {
			case event, ok := <-ch:
				if !ok {
					return
				}
				dataBytes, _ := json.Marshal(event.Data)
				_, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Event, dataBytes)
				if err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			case <-ticker.C:
				_, err := fmt.Fprintf(w, ": keep-alive\n\n")
				if err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			}
		}
	})
}
