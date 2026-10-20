package repository

import (
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"infranexus/internal/domain"
)

func TestRedisAuthAtomicity(t *testing.T) {
	server, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	store := NewAuthRepository(client)
	ctx := t.Context()
	now := time.Now()
	old := domain.Session{ID: "old", UserID: uuid.New(), ExpiresAt: now.Add(time.Minute), AbsoluteExpiresAt: now.Add(2 * time.Minute)}
	if err := store.SaveSession(ctx, old, ""); err != nil {
		t.Fatal(err)
	}
	next := old
	next.ID = "new"
	if err := store.SaveSession(ctx, next, "old"); err != nil {
		t.Fatal(err)
	}
	if s, err := store.RenewSession(ctx, "old", now, time.Minute); err != nil || s != nil {
		t.Fatalf("old session active: %v %v", s, err)
	}
	s, err := store.RenewSession(ctx, "new", now.Add(30*time.Second), time.Hour)
	if err != nil || s == nil || s.ExpiresAt.After(next.AbsoluteExpiresAt) {
		t.Fatalf("absolute TTL exceeded: %v %v", s, err)
	}
	if err := store.DeleteSession(ctx, "new"); err != nil {
		t.Fatal(err)
	}
	if s, err := store.RenewSession(ctx, "new", now, time.Minute); err != nil || s != nil {
		t.Fatalf("deleted session revived: %v %v", s, err)
	}
	expiry := time.Now().Add(time.Minute)
	if err := store.CreateFamily(ctx, "f", "old", expiry); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	out := make(chan bool, 16)
	for range 16 {
		wg.Go(func() {
			ok, err := store.RotateFamily(ctx, "f", "old", "next", expiry)
			if err != nil {
				t.Error(err)
			}
			out <- ok
		})
	}
	wg.Wait()
	close(out)
	success := 0
	for ok := range out {
		if ok {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("rotations=%d", success)
	}
	if err := store.RevokeFamily(ctx, "f"); err != nil {
		t.Fatal(err)
	}
	if ok, err := store.CheckFamily(ctx, "f"); err != nil || ok {
		t.Fatalf("revoked family: %v %v", ok, err)
	}
	server.Close()
	if _, err := store.CheckFamily(ctx, "unavailable"); err == nil {
		t.Fatal("Redis failure ignored")
	}
}
