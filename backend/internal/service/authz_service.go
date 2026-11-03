package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/casbin/casbin/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
)

const (
	authorizationPollInterval = 500 * time.Millisecond
	authorizationMinRetry     = 100 * time.Millisecond
	authorizationMaxRetry     = 30 * time.Second
)

type authorizationService struct {
	enforcer *casbin.SyncedEnforcer
	roleRepo domain.RoleRepository
	permRepo domain.PermissionRepository
	state    domain.AuthorizationOutboxRepository
	notifier domain.AuthorizationNotifier
	logger   *slog.Logger

	refreshMu sync.Mutex
	loadedRev atomic.Int64
}

func NewAuthorizationService(
	enforcer *casbin.SyncedEnforcer,
	roleRepo domain.RoleRepository,
	permRepo domain.PermissionRepository,
	state domain.AuthorizationOutboxRepository,
	notifier domain.AuthorizationNotifier,
	logger *slog.Logger,
) domain.AuthorizationService {
	service := &authorizationService{
		enforcer: enforcer,
		roleRepo: roleRepo,
		permRepo: permRepo,
		state:    state,
		notifier: notifier,
		logger:   logger,
	}
	service.loadedRev.Store(-1)
	return service
}

func (s *authorizationService) SyncRolePolicies(ctx context.Context, roleID uuid.UUID) error {
	if err := s.roleRepo.SyncRoleAuthorizationPolicy(ctx, roleID); err != nil {
		return err
	}
	return s.RefreshIfStale(ctx)
}

func (s *authorizationService) SyncAllPolicies(ctx context.Context) (int, int, error) {
	added, removed, err := s.roleRepo.SyncAllAuthorizationPolicies(ctx)
	if err != nil {
		return 0, 0, err
	}
	if err := s.RefreshIfStale(ctx); err != nil {
		return added, removed, err
	}
	return added, removed, nil
}

func (s *authorizationService) RefreshIfStale(ctx context.Context) error {
	if s.state == nil {
		return errors.New("authorization revision repository is unavailable")
	}
	revision, err := s.state.Revision(ctx)
	if err != nil {
		return err
	}
	if revision == s.loadedRev.Load() {
		return nil
	}

	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	for range 3 {
		before, err := s.state.Revision(ctx)
		if err != nil {
			return err
		}
		if before == s.loadedRev.Load() {
			return nil
		}
		if err := s.enforcer.LoadPolicy(); err != nil {
			return err
		}
		after, err := s.state.Revision(ctx)
		if err != nil {
			return err
		}
		if before == after {
			s.loadedRev.Store(after)
			return nil
		}
	}
	return errors.New("authorization policy changed repeatedly while reloading")
}

func (s *authorizationService) Enforce(ctx context.Context, subject, object, action string) (bool, error) {
	if err := s.RefreshIfStale(ctx); err != nil {
		return false, err
	}
	return s.enforcer.Enforce(subject, object, action)
}

func (s *authorizationService) Run(ctx context.Context) {
	ctx = requestmeta.WithTask(ctx, uuid.NewString(), "")
	if s.notifier == nil || s.state == nil {
		<-ctx.Done()
		return
	}
	ticker := time.NewTicker(authorizationPollInterval)
	defer ticker.Stop()

	var revisions <-chan int64
	var retrySubscribeAt time.Time
	for {
		if revisions == nil && (retrySubscribeAt.IsZero() || !time.Now().Before(retrySubscribeAt)) {
			channel, err := s.notifier.Subscribe(ctx)
			if err != nil {
				s.logWorkerError(ctx, "subscribe", err)
				retrySubscribeAt = time.Now().Add(2 * time.Second)
			} else {
				revisions = channel
				retrySubscribeAt = time.Time{}
				// Subscribe before taking the snapshot so changes are either
				// included in this load or delivered by the stream after it.
				if err := s.RefreshIfStale(ctx); err != nil {
					s.logWorkerError(ctx, "refresh-after-subscribe", err)
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case revision, open := <-revisions:
			if !open {
				revisions = nil
				retrySubscribeAt = time.Now().Add(time.Second)
				continue
			}
			if err := s.RefreshIfStale(ctx); err != nil {
				s.logWorkerError(ctx, "refresh", err)
			} else if s.loadedRev.Load() < revision {
				// Revision checks are authoritative; a later poll retries transient DB visibility.
				s.logWorkerError(ctx, "refresh-revision", errors.New("notifier revision is ahead of local snapshot"))
			}
		case <-ticker.C:
			if err := s.publishPending(ctx); err != nil {
				s.logWorkerError(ctx, "outbox", err)
			}
		}
	}
}

func (s *authorizationService) publishPending(ctx context.Context) error {
	// Scope idle-log suppression to this polling SELECT, never the subsequent
	// publish/update operations or other queries sharing the worker context.
	rows, err := s.state.Pending(requestmeta.WithSQLPoll(ctx), time.Now(), 100)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := s.notifier.Publish(ctx, row.Revision); err != nil {
			delay := authorizationRetryDelay(row.AttemptCount)
			markErr := s.state.MarkFailed(ctx, row.ID, err.Error(), time.Now().Add(delay))
			if markErr != nil {
				return errors.Join(err, markErr)
			}
			continue
		}
		if err := s.state.MarkPublished(ctx, row.ID, time.Now()); err != nil {
			return err
		}
	}
	return nil
}

func authorizationRetryDelay(attempt int) time.Duration {
	delay := authorizationMinRetry
	for range min(max(attempt, 0), 8) {
		delay *= 2
	}
	return min(delay, authorizationMaxRetry)
}

func (s *authorizationService) logWorkerError(ctx context.Context, operation string, err error) {
	if s.logger != nil {
		s.logger.WarnContext(ctx, "authorization convergence worker operation failed", "component", "authorization_service", "event", "authorization.worker_retry", "operation", operation, "error_type", fmt.Sprintf("%T", err))
	}
}

func (s *authorizationService) EffectivePermissions(ctx context.Context, roleCodes []string) ([]string, bool, error) {
	if slices.Contains(roleCodes, domain.AdminRoleCode) {
		return []string{domain.AllPermissions}, true, nil
	}
	if len(roleCodes) == 0 {
		return []string{}, false, nil
	}
	roles, err := s.roleRepo.ListWithPermissions(ctx, roleCodes)
	if err != nil {
		return nil, false, err
	}
	all, err := s.permRepo.ListAll(ctx)
	if err != nil {
		return nil, false, err
	}
	byID := make(map[uuid.UUID]domain.Permission, len(all))
	for _, p := range all {
		byID[p.ID] = p
	}
	granted := make(map[string]bool)
	for _, role := range roles {
		if role.Status != domain.StatusEnabled {
			continue
		}
		for _, p := range role.Permissions {
			granted[p.Code] = true
			for parent := p.ParentID; parent != nil; {
				ancestor, ok := byID[*parent]
				if !ok || granted[ancestor.Code] {
					break
				}
				granted[ancestor.Code] = true
				parent = ancestor.ParentID
			}
		}
	}
	codes := make([]string, 0, len(granted))
	for code := range granted {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes, false, nil
}

func (s *authorizationService) HasAPIAccess(ctx context.Context, roleCodes []string, method, path string) (bool, error) {
	if slices.Contains(roleCodes, domain.AdminRoleCode) {
		return true, nil
	}
	for _, roleCode := range roleCodes {
		allowed, err := s.Enforce(ctx, roleCode, path, method)
		if err != nil {
			return false, err
		}
		if allowed {
			return true, nil
		}
	}
	return false, nil
}
