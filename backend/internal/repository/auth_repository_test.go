package repository

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"infranexus/internal/domain"
)

func TestMemorySessionLifetimeAndReplacement(t *testing.T) {
	r := NewAuthRepository(nil)
	now := time.Now()
	ctx := t.Context()
	id := uuid.New()
	old := domain.Session{ID: "old", UserID: id, ExpiresAt: now.Add(time.Minute), AbsoluteExpiresAt: now.Add(2 * time.Minute)}
	if err := r.SaveSession(ctx, old, ""); err != nil {
		t.Fatal(err)
	}
	newSession := old
	newSession.ID = "new"
	if err := r.SaveSession(ctx, newSession, "old"); err != nil {
		t.Fatal(err)
	}
	if s, err := r.RenewSession(ctx, "old", now, time.Minute); err != nil || s != nil {
		t.Fatalf("replaced session still active: %v %v", s, err)
	}
	s, err := r.RenewSession(ctx, "new", now.Add(90*time.Second), time.Minute)
	if err != nil || s != nil {
		t.Fatalf("idle-expired session revived: %v %v", s, err)
	}
	newSession.ExpiresAt = now.Add(time.Minute)
	if err := r.SaveSession(ctx, newSession, ""); err != nil {
		t.Fatal(err)
	}
	s, err = r.RenewSession(ctx, "new", now.Add(30*time.Second), time.Hour)
	if err != nil || s == nil || s.ExpiresAt.After(newSession.AbsoluteExpiresAt) {
		t.Fatalf("absolute expiry exceeded: %v %v", s, err)
	}
	s, err = r.RenewSession(ctx, "new", now.Add(2*time.Minute), time.Minute)
	if err != nil || s != nil {
		t.Fatalf("absolute-expired session revived: %v %v", s, err)
	}
}
func TestMemoryRefreshRotationConcurrent(t *testing.T) {
	r := NewAuthRepository(nil)
	ctx := t.Context()
	expiry := time.Now().Add(time.Minute)
	if err := r.CreateFamily(ctx, "family", "old", expiry); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan bool, 32)
	for range 32 {
		wg.Go(func() {
			ok, err := r.RotateFamily(ctx, "family", "old", "next", expiry)
			if err != nil {
				t.Error(err)
			}
			results <- ok
		})
	}
	wg.Wait()
	close(results)
	success := 0
	for ok := range results {
		if ok {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("rotations=%d, want 1", success)
	}
	if err := r.RevokeFamily(ctx, "family"); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.CheckFamily(ctx, "family"); err != nil || ok {
		t.Fatalf("revoked family active: %v %v", ok, err)
	}
}
