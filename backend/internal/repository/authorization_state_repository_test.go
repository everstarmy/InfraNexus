package repository

import (
	"context"
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
