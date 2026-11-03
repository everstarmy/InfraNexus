package repository

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"infranexus/internal/domain"
)

func TestRedisRejectsInvalidSessionLifetimes(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name string
		data string
	}{
		{"legacy session", `{"session_id":"legacy","username":"admin","roles":["admin"],"created_at":"2026-10-20T18:21:08+08:00"}`},
		{"missing absolute expiry", `{"expires_at":9999999999999}`},
		{"string expiry", `{"expires_at":"2026-10-20T18:21:08+08:00","absolute_expires_at":9999999999999}`},
		{"null expiry", `{"expires_at":null,"absolute_expires_at":9999999999999}`},
		{"invalid json", `{`},
		{"scalar json", `42`},
		{"null json", `null`},
		{"idle expired", `{"expires_at":1,"absolute_expires_at":9999999999999}`},
		{"absolute expired", `{"expires_at":9999999999999,"absolute_expires_at":1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: server.Addr()})
			t.Cleanup(func() { _ = client.Close() })
			store := NewAuthRepository(client)
			ctx := t.Context()
			for _, operation := range []string{"renew", "update idle"} {
				t.Run(operation, func(t *testing.T) {
					server.Set(sessionKey("invalid"), tc.data)
					if operation == "renew" {
						s, err := store.RenewSession(ctx, "invalid", now, time.Minute)
						if err != nil || s != nil {
							t.Fatalf("invalid session should expire, got session=%v error=%v", s, err)
						}
					} else if err := store.UpdateSessionIdle(ctx, "invalid", 60000, 60000); err != nil {
						t.Fatalf("invalid session idle update: %v", err)
					}
					if server.Exists(sessionKey("invalid")) {
						t.Fatal("invalid session was retained or revived")
					}
				})
			}
		})
	}
}

func TestRedisSessionCustomIdleTimeout(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	store := NewAuthRepository(client)
	ctx := t.Context()
	now := time.Now().Truncate(time.Millisecond)
	session := domain.Session{
		ID: "custom-idle", UserID: uuid.New(), CreatedAt: now,
		ExpiresAt: now.Add(time.Minute), AbsoluteExpiresAt: now.Add(time.Hour),
	}
	if err := store.SaveSession(ctx, session, ""); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateSessionIdle(ctx, session.ID, 20000, 60000); err != nil {
		t.Fatal(err)
	}
	renewed, err := store.RenewSession(ctx, session.ID, now.Add(time.Second), time.Minute)
	if err != nil || renewed == nil {
		t.Fatalf("renew session: session=%v error=%v", renewed, err)
	}
	if want := now.Add(21 * time.Second); !renewed.ExpiresAt.Equal(want) {
		t.Fatalf("expiry=%v, want %v", renewed.ExpiresAt, want)
	}
	raw, err := server.Get(sessionKey(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	var stored sessionWire
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		t.Fatal(err)
	}
	if stored.IdleTimeout != 20000 || stored.AbsoluteExpiresAt != session.AbsoluteExpiresAt.UnixMilli() {
		t.Fatalf("session lifetime changed unexpectedly: %+v", stored)
	}
}

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
