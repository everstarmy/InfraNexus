package service

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"infranexus/internal/domain"
	"testing"
)

type batchTestRepo struct {
	domain.UserRepository
	users      map[uuid.UUID]*domain.User
	targets    []uuid.UUID
	failOnce   uuid.UUID
	writes     map[uuid.UUID]int
	afterWrite func()
}

func (r *batchTestRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	value := *r.users[id]
	return &value, nil
}
func (r *batchTestRepo) Search(_ context.Context, f domain.UserFilter) ([]domain.User, int64, error) {
	result := []domain.User{}
	for _, id := range r.targets {
		if f.IDs != nil {
			found := false
			for _, selected := range f.IDs {
				if selected == id {
					found = true
				}
			}
			if !found {
				continue
			}
		}
		result = append(result, *r.users[id])
	}
	return result, int64(len(result)), nil
}
func (r *batchTestRepo) UpdateStatus(_ context.Context, id uuid.UUID, status int, revision int64) error {
	if id == r.failOnce {
		r.failOnce = uuid.Nil
		return errors.New("temporary storage failure")
	}
	if r.users[id].EditRevision != revision {
		return domain.ErrEditRevisionConflict
	}
	r.users[id].Status = status
	r.users[id].EditRevision++
	r.writes[id]++
	if r.afterWrite != nil {
		r.afterWrite()
	}
	return nil
}

type batchTestAuthz struct {
	domain.AuthorizationService
	revoked bool
}

func (a *batchTestAuthz) HasAPIAccess(context.Context, []string, string, string) (bool, error) {
	return !a.revoked, nil
}

func TestBatchTransientRetryAndPermissionRecheck(t *testing.T) {
	for _, revoke := range []bool{false, true} {
		t.Run(map[bool]string{false: "transient retry", true: "permission revoked"}[revoke], func(t *testing.T) {
			actor, a, b := uuid.New(), uuid.New(), uuid.New()
			repo := &batchTestRepo{users: map[uuid.UUID]*domain.User{}, targets: []uuid.UUID{a, b}, writes: map[uuid.UUID]int{}}
			for _, id := range []uuid.UUID{actor, a, b} {
				repo.users[id] = &domain.User{BaseEntity: domain.BaseEntity{ID: id}, Status: 1, EditRevision: 1}
			}
			authz := &batchTestAuthz{}
			if revoke {
				repo.afterWrite = func() { authz.revoked = true }
			} else {
				repo.failOnce = b
			}
			s := NewUserService(repo, nil, nil, nil, authz)
			req := domain.UserBatchRequest{Selection: domain.UserSelection{Mode: "ids", IDs: []uuid.UUID{a, b}}, Status: 2, Items: []domain.UserBatchVersion{{ID: a, Revision: 1}, {ID: b, Revision: 1}}}
			result, err := s.BatchStatus(t.Context(), actor, req)
			if err != nil || result.Success != 1 || result.Failed != 1 {
				t.Fatalf("partial result: %+v %v", result, err)
			}
			if result.Items[1].Retryable == revoke {
				t.Fatalf("incorrect retryability: %+v", result.Items[1])
			}
			if revoke {
				if repo.writes[b] != 0 {
					t.Fatal("write after permissions revoked")
				}
				return
			}
			req.Items = req.Items[1:]
			req.Selection.IDs = []uuid.UUID{b}
			result, err = s.BatchStatus(t.Context(), actor, req)
			if err != nil || result.Success != 1 || repo.writes[a] != 1 || repo.writes[b] != 1 {
				t.Fatalf("retry duplicated success: %+v %v %v", result, err, repo.writes)
			}
		})
	}
}
