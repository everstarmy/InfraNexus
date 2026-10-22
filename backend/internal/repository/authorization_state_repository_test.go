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
