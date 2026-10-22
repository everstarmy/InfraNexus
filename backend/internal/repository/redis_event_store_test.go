package repository

import (
	"os"
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
