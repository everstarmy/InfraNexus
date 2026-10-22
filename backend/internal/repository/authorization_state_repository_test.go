package repository

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestAuthorizationNotifierPublishesAcrossInstances(t *testing.T) {
	publisherClient, subscriberClient := redisTestClients(t)
	publisher := NewRedisAuthorizationNotifier(publisherClient)
	subscriber := NewRedisAuthorizationNotifier(subscriberClient)

	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	revisions, err := subscriber.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := publisher.Publish(ctx, 42); err != nil {
		t.Fatal(err)
	}
	select {
	case revision, open := <-revisions:
		if !open || revision != 42 {
			t.Fatalf("received revision = %d, open=%v; want 42", revision, open)
		}
	case <-time.After(time.Second):
		t.Fatal("authorization revision was not delivered to the second instance")
	}
}

func TestAuthorizationNotifierClosesIdleSubscriptionOnCancel(t *testing.T) {
	client, _ := redisTestClients(t)
	notifier := NewRedisAuthorizationNotifier(client)
	ctx, cancel := context.WithCancel(t.Context())
	revisions, err := notifier.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case _, open := <-revisions:
		if open {
			t.Fatal("idle authorization subscription remained open after cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("idle authorization subscription did not close after cancellation")
	}
}

func TestAuthorizationNotifierCoalescesFullBufferAndClosesOnCancel(t *testing.T) {
	publisherClient, subscriberClient := redisTestClients(t)
	publisher := NewRedisAuthorizationNotifier(publisherClient)
	subscriber := NewRedisAuthorizationNotifier(subscriberClient)
	ctx, cancel := context.WithCancel(t.Context())
	revisions, err := subscriber.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for revision := int64(1); revision <= 128; revision++ {
		if err := publisher.Publish(ctx, revision); err != nil {
			t.Fatal(err)
		}
	}
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for len(revisions) < cap(revisions) {
		select {
		case <-deadline.C:
			t.Fatal("authorization notifier did not fill its bounded output buffer")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := publisher.Publish(ctx, 129); err != nil {
		t.Fatal(err)
	}
	latest := int64(0)
	for latest < 129 {
		select {
		case revision, open := <-revisions:
			if !open {
				t.Fatal("authorization subscription closed before delivering its newest revision")
			}
			if revision > latest {
				latest = revision
			}
		case <-deadline.C:
			t.Fatal("full authorization buffer did not coalesce to the latest revision")
		}
	}
	cancel()
	for {
		select {
		case _, open := <-revisions:
			if !open {
				return
			}
		case <-time.After(time.Second):
			t.Fatal("full authorization subscription did not close after cancellation")
		}
	}
}

// This command deliberately terminates only PubSub connections on the isolated
// Redis configured by the integration runner; application Redis is never used.
func TestAuthorizationNotifierReconnectsAndReleasesConnections(t *testing.T) {
	if os.Getenv("INFRANEXUS_TEST_REDIS_ADDR") == "" {
		t.Skip("requires isolated real Redis for CLIENT KILL")
	}
	admin, subscriber := redisTestClients(t)
	if err := subscriber.Ping(t.Context()).Err(); err != nil {
		t.Fatal(err)
	}
	connectionCount := func() int {
		t.Helper()
		clients, err := admin.ClientList(t.Context()).Result()
		if err != nil {
			t.Fatal(err)
		}
		return len(strings.Split(strings.TrimSpace(clients), "\n"))
	}
	baselineConnections := connectionCount()
	notifier := NewRedisAuthorizationNotifier(subscriber)
	waitSubscribers := func(want int64) {
		t.Helper()
		deadline := time.NewTimer(3 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			counts, err := admin.PubSubNumSub(t.Context(), authorizationChangedChannel).Result()
			if err != nil {
				t.Fatal(err)
			}
			if counts[authorizationChangedChannel] == want {
				return
			}
			select {
			case <-ticker.C:
			case <-deadline.C:
				t.Fatalf("PubSub subscriptions = %d, want %d", counts[authorizationChangedChannel], want)
			}
		}
	}
	waitSubscribers(0)
	for iteration := range 10 {
		ctx, cancel := context.WithCancel(t.Context())
		revisions, err := notifier.Subscribe(ctx)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		t.Cleanup(cancel)
		waitSubscribers(1)
		if iteration == 0 {
			killed, err := admin.ClientKillByFilter(t.Context(), "TYPE", "pubsub").Result()
			if err != nil || killed != 1 {
				t.Fatalf("kill PubSub: count=%d err=%v", killed, err)
			}
			waitSubscribers(1)
			if err := notifier.Publish(ctx, 99); err != nil {
				t.Fatal(err)
			}
			select {
			case revision, open := <-revisions:
				if !open || revision != 99 {
					t.Fatalf("reconnected revision=%d open=%v", revision, open)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("reconnected subscriber did not receive revision")
			}
		}
		cancel()
		select {
		case _, open := <-revisions:
			if open {
				t.Fatal("subscription not closed")
			}
		case <-time.After(time.Second):
			t.Fatal("subscription cancellation timed out")
		}
		waitSubscribers(0)
		deadline := time.NewTimer(time.Second)
		ticker := time.NewTicker(10 * time.Millisecond)
		for connectionCount() != baselineConnections {
			select {
			case <-ticker.C:
			case <-deadline.C:
				ticker.Stop()
				t.Fatalf("cancel left Redis connections: got=%d baseline=%d", connectionCount(), baselineConnections)
			}
		}
		ticker.Stop()
		deadline.Stop()
	}
}
