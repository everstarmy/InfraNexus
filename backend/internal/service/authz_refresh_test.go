package service

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/casbin/casbin/v3"
	"github.com/casbin/casbin/v3/model"
	"github.com/casbin/casbin/v3/persist"

	"infranexus/internal/middleware"
)

type changingRevisionState struct {
	fixedAuthorizationState
	current     atomic.Int64
	reads       atomic.Int64
	requestRead chan struct{}
}

func (s *changingRevisionState) Revision(context.Context) (int64, error) {
	if s.reads.Add(1) == 3 && s.requestRead != nil {
		close(s.requestRead)
	}
	return s.current.Load(), nil
}

type callbackPolicyAdapter struct {
	persist.Adapter
	load func(model.Model) error
}

func (a callbackPolicyAdapter) LoadPolicy(m model.Model) error { return a.load(m) }

type refreshNotifier struct{ revisions chan int64 }

func (n refreshNotifier) Subscribe(context.Context) (<-chan int64, error) { return n.revisions, nil }
func (refreshNotifier) Publish(context.Context, int64) error              { return nil }
func refreshTestEnforcer(t *testing.T, load func(model.Model) error) *casbin.SyncedEnforcer {
	t.Helper()
	m, err := model.NewModelFromString(middleware.RBACModel)
	if err != nil {
		t.Fatal(err)
	}
	e, err := casbin.NewSyncedEnforcer(m)
	if err != nil {
		t.Fatal(err)
	}
	e.SetAdapter(callbackPolicyAdapter{load: load})
	return e
}
func TestAuthorizationRejectsContinuouslyChangingSnapshotsAndRecovers(t *testing.T) {
	state := &changingRevisionState{}
	state.current.Store(1)
	loads, changing := 0, true
	e := refreshTestEnforcer(t, func(m model.Model) error {
		loads++
		if changing {
			state.current.Add(1)
			return persist.LoadPolicyLine("p, operator, /users, GET", m)
		}
		return nil
	})
	svc := NewAuthorizationService(e, nil, nil, state, nil, nil).(*authorizationService)
	allowed, err := svc.Enforce(t.Context(), "operator", "/users", "GET")
	if err == nil || allowed || loads != 3 || svc.loadedRev.Load() != -1 {
		t.Fatalf("unstable snapshot: allowed=%v err=%v loads=%d loaded=%d", allowed, err, loads, svc.loadedRev.Load())
	}
	changing = false
	allowed, err = svc.Enforce(t.Context(), "operator", "/users", "GET")
	if err != nil || allowed || svc.loadedRev.Load() != 4 || loads != 4 {
		t.Fatalf("stable revoked snapshot: allowed=%v err=%v loads=%d loaded=%d", allowed, err, loads, svc.loadedRev.Load())
	}
}
func TestAuthorizationWorkerAndRequestShareStableRefresh(t *testing.T) {
	state := &changingRevisionState{requestRead: make(chan struct{})}
	state.current.Store(1)
	entered, release := make(chan struct{}), make(chan struct{})
	var loads atomic.Int64
	e := refreshTestEnforcer(t, func(m model.Model) error {
		if loads.Add(1) == 1 {
			close(entered)
			<-release
			return persist.LoadPolicyLine("p, operator, /users, GET", m)
		}
		return nil
	})
	svc := NewAuthorizationService(e, nil, nil, state, refreshNotifier{make(chan int64)}, nil).(*authorizationService)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); svc.Run(ctx) }()
	<-entered
	type result struct {
		allowed bool
		err     error
	}
	requestDone := make(chan result, 1)
	go func() {
		allowed, err := svc.Enforce(ctx, "operator", "/users", "GET")
		requestDone <- result{allowed, err}
	}()
	<-state.requestRead
	state.current.Store(2)
	close(release)
	got := <-requestDone
	if got.err != nil || got.allowed || svc.loadedRev.Load() != 2 || loads.Load() != 2 {
		t.Fatalf("interleaved revocation: allowed=%v err=%v loaded=%d loads=%d", got.allowed, got.err, svc.loadedRev.Load(), loads.Load())
	}
	cancel()
	<-workerDone
}
