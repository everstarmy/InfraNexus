package repository

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRedisEventStoreReplayRetentionAndOverflow(t *testing.T) {
	client, secondClient := redisTestClients(t)
	exerciseRedisEventStore(t, client, secondClient)
}

func redisTestClients(t *testing.T) (*redis.Client, *redis.Client) {
	t.Helper()
	addr := os.Getenv("INFRANEXUS_TEST_REDIS_ADDR")
	if addr == "" {
		server := miniredis.RunT(t)
		addr = server.Addr()
	} else {
		client := redis.NewClient(&redis.Options{Addr: addr})
		if err := client.Ping(t.Context()).Err(); err != nil {
			t.Fatalf("connect test Redis server: %v", err)
		}
		if err := client.FlushDB(t.Context()).Err(); err != nil {
			t.Fatalf("isolate test Redis database: %v", err)
		}
		if err := client.Close(); err != nil {
			t.Fatal(err)
		}
	}
	client := redis.NewClient(&redis.Options{Addr: addr})
	secondClient := redis.NewClient(&redis.Options{Addr: addr})
	t.Cleanup(func() { _ = client.Close() })
	t.Cleanup(func() { _ = secondClient.Close() })
	return client, secondClient
}

func exerciseRedisEventStore(t *testing.T, client, secondClient *redis.Client) {
	t.Helper()
	publisher := NewRedisEventStore(client)
	store := NewRedisEventStore(secondClient)
	ctx := t.Context()

	if err := publisher.Publish(ctx, "test.created", map[string]string{"name": "first"}); err != nil {
		t.Fatal(err)
	}
	firstID, err := store.LatestID(ctx)
	if err != nil || firstID == "0-0" {
		t.Fatalf("LatestID() = %q, %v", firstID, err)
	}
	if err := publisher.Publish(ctx, "test.updated", map[string]string{"name": "second"}); err != nil {
		t.Fatal(err)
	}
	events, snapshot, err := store.Read(ctx, firstID, 0, 10)
	if err != nil || snapshot || len(events) != 1 || events[0].Name != "test.updated" {
		t.Fatalf("Read after last ID = (%+v, %v, %v), want only second event", events, snapshot, err)
	}
	if string(events[0].Data) != `{"name":"second"}` || events[0].Time.IsZero() {
		t.Fatalf("decoded event data/time = %s / %v", events[0].Data, events[0].Time)
	}

	if err := client.XDel(ctx, realtimeEventStream, firstID).Err(); err != nil {
		t.Fatal(err)
	}
	events, snapshot, err = store.Read(ctx, firstID, 0, 10)
	if err != nil || !snapshot || len(events) != 1 || events[0].Name != "snapshot.required" {
		t.Fatalf("Read after retention gap = (%+v, %v, %v), want snapshot request", events, snapshot, err)
	}

	for range 4 {
		if err := publisher.Publish(ctx, "test.progress", map[string]int{"value": 1}); err != nil {
			t.Fatal(err)
		}
	}
	events, snapshot, err = store.Read(ctx, "0-0", time.Millisecond, 2)
	if err != nil || !snapshot || len(events) != 1 || events[0].Name != "snapshot.required" {
		t.Fatalf("Read after subscriber backlog = (%+v, %v, %v), want snapshot request", events, snapshot, err)
	}
}

// CLIENT LIST is used only against the disposable integration Redis.
func TestRedisEventStoreCancellationReleasesBlockedRead(t *testing.T) {
	if os.Getenv("INFRANEXUS_TEST_REDIS_ADDR") == "" {
		t.Skip("requires isolated real Redis")
	}
	admin, reader := redisTestClients(t)
	if err := reader.Ping(t.Context()).Err(); err != nil {
		t.Fatal(err)
	}
	clients := func() string {
		t.Helper()
		value, err := admin.ClientList(t.Context()).Result()
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	baseline := len(strings.Split(strings.TrimSpace(clients()), "\n"))
	wait := func(predicate func(string) bool) {
		t.Helper()
		timeout := time.NewTimer(2 * time.Second)
		defer timeout.Stop()
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			if predicate(clients()) {
				return
			}
			select {
			case <-ticker.C:
			case <-timeout.C:
				t.Fatal("Redis connection state did not converge")
			}
		}
	}
	store := NewRedisEventStore(reader)
	for range 5 {
		ctx, cancel := context.WithCancel(t.Context())
		t.Cleanup(cancel)
		done := make(chan error, 1)
		go func() { _, _, err := store.Read(ctx, "0-0", 30*time.Second, 100); done <- err }()
		wait(func(value string) bool { return strings.Contains(value, "cmd=xread") })
		cancel()
		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("read cancellation = %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("cancelled Redis XREAD remained blocked")
		}
		if err := reader.Ping(t.Context()).Err(); err != nil {
			t.Fatalf("shared client was closed: %v", err)
		}
		wait(func(value string) bool {
			return len(strings.Split(strings.TrimSpace(value), "\n")) == baseline && !strings.Contains(value, "cmd=xread")
		})
	}
}
