package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/requestmeta"
	"infranexus/internal/core/validator"
	"infranexus/internal/domain"
)

type ManagedRule[T any] func(context.Context, *T, *T) error

type managedService[T any, P domain.ManagedEntity[T]] struct {
	repo  domain.ManagedRepository[T]
	uow   domain.ManagedUnitOfWork
	rule  ManagedRule[T]
	table string
}

func NewManagedService[T any, P domain.ManagedEntity[T]](repo domain.ManagedRepository[T], uow domain.ManagedUnitOfWork, rule ManagedRule[T]) domain.ManagedService[T] {
	return &managedService[T, P]{repo: repo, uow: uow, rule: rule, table: P(new(T)).TableName()}
}

func (s *managedService[T, P]) List(ctx context.Context, q domain.ManagedQuery) ([]T, int64, error) {
	return s.repo.List(ctx, q)
}
func (s *managedService[T, P]) Get(ctx context.Context, id uuid.UUID) (*T, error) {
	out, err := s.repo.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrManagedNotFound
	}
	return out, err
}
func (s *managedService[T, P]) References(ctx context.Context, id uuid.UUID) ([]domain.ManagedReferenceCount, error) {
	if _, err := s.Get(ctx, id); err != nil {
		return nil, err
	}
	return s.uow.References(ctx, s.table, id)
}

func (s *managedService[T, P]) History(ctx context.Context, id uuid.UUID, q domain.ManagedQuery) ([]domain.ManagedAudit, int64, error) {
	items, total, err := s.uow.History(ctx, s.table, id, q)
	if err == nil && total == 0 {
		_, err = s.Get(ctx, id)
	}
	return items, total, err
}

func (s *managedService[T, P]) validate(ctx context.Context, item, old *T) error {
	b := P(item).ManagedFields()
	b.Name = strings.TrimSpace(b.Name)
	if err := validator.Validate(item); err != nil {
		return err
	}
	if s.rule != nil {
		return s.rule(ctx, item, old)
	}
	return nil
}

func auditValues(base *domain.ManagedBase) domain.ManagedAuditFields {
	if base == nil {
		return domain.ManagedAuditFields{}
	}
	return domain.ManagedAuditFields{Name: base.Name, Status: base.Status, Version: base.Version}
}

func writeManagedAudit(ctx context.Context, uow domain.ManagedUnitOfWork, actor uuid.UUID, table string, id uuid.UUID, action string, before, after domain.ManagedAuditFields) error {
	return uow.Audit(ctx, &domain.ManagedAudit{
		Resource: table, ResourceID: id, ActorID: actor, RequestID: requestmeta.RequestID(ctx), Action: action,
		Before: datatypes.NewJSONType(before), After: datatypes.NewJSONType(after),
	})
}

func (s *managedService[T, P]) create(ctx context.Context, actor uuid.UUID, item T) (*T, error) {
	b := P(&item).ManagedFields()
	b.BaseEntity = domain.BaseEntity{}
	b.Version = 1
	b.Status = domain.StatusEnabled
	if err := s.validate(ctx, &item, nil); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, &item); err != nil {
		return nil, err
	}
	return &item, writeManagedAudit(ctx, s.uow, actor, s.table, b.ID, "create", domain.ManagedAuditFields{}, auditValues(P(&item).ManagedFields()))
}

// managedReplay executes inside the write transaction so the result and all
// corresponding changes commit together.
func managedReplay[T any](ctx context.Context, uow domain.ManagedUnitOfWork, actor uuid.UUID, operation, key string, input any, fn func() (T, error)) (T, error) {
	var out T
	if key == "" {
		return fn()
	}
	if len(key) > 128 {
		return out, coreerrors.ErrParamInvalid.WithMessage("Idempotency-Key 最多 128 字节")
	}
	body, err := json.Marshal(input)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	r, err := uow.Receipt(ctx, actor, operation, key)
	switch {
	case err == nil:
		if digest != r.Digest {
			return out, domain.ErrManagedKeyReuse
		}
		err = json.Unmarshal(r.Result.Data(), &out)
		return out, err
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return out, err
	}
	out, err = fn()
	if err != nil {
		return out, err
	}
	result, err := json.Marshal(out)
	if err != nil {
		return out, err
	}
	err = uow.SaveReceipt(ctx, &domain.ManagedReceipt{ActorID: actor, Operation: operation, Key: key, Digest: digest, Result: datatypes.NewJSONType(jsontext.Value(result))})
	return out, err
}

func (s *managedService[T, P]) Create(ctx context.Context, actor uuid.UUID, key string, item T) (out *T, err error) {
	err = s.uow.Write(ctx, func(tx context.Context) error {
		out, err = managedReplay(tx, s.uow, actor, s.table+":create", key, item, func() (*T, error) { return s.create(tx, actor, item) })
		return err
	})
	return out, err
}

func (s *managedService[T, P]) loadForWrite(ctx context.Context, id uuid.UUID, version int64) (*T, error) {
	if version < 1 {
		return nil, coreerrors.ErrParamInvalid.WithMessage("expected_version 必须为正整数")
	}
	item, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if P(item).ManagedFields().Version != version {
		return nil, domain.ErrEditRevisionConflict
	}
	return item, nil
}

func (s *managedService[T, P]) save(ctx context.Context, actor uuid.UUID, item, old *T, action string) error {
	b, previous := P(item).ManagedFields(), P(old).ManagedFields()
	b.Version = previous.Version + 1
	b.BaseEntity = previous.BaseEntity
	if err := s.repo.Update(ctx, item); err != nil {
		return err
	}
	return writeManagedAudit(ctx, s.uow, actor, s.table, b.ID, action, auditValues(P(old).ManagedFields()), auditValues(P(item).ManagedFields()))
}

func (s *managedService[T, P]) Update(ctx context.Context, actor, id uuid.UUID, version int64, item T) (*T, error) {
	err := s.uow.Write(ctx, func(tx context.Context) error {
		old, err := s.loadForWrite(tx, id, version)
		if err != nil {
			return err
		}
		P(&item).ManagedFields().Status = P(old).ManagedFields().Status
		if err := s.validate(tx, &item, old); err != nil {
			return err
		}
		return s.save(tx, actor, &item, old, "update")
	})
	return &item, err
}

func (s *managedService[T, P]) SetStatus(ctx context.Context, actor, id uuid.UUID, version int64, status int) (out *T, err error) {
	if status != domain.StatusEnabled && status != domain.StatusDisabled {
		return nil, coreerrors.ErrParamInvalid
	}
	err = s.uow.Write(ctx, func(tx context.Context) error {
		old, e := s.loadForWrite(tx, id, version)
		if e != nil {
			return e
		}
		before := P(old).ManagedFields()
		if before.Status == status {
			out = old
			return nil
		}
		item := *old
		P(&item).ManagedFields().Status = status
		if status == domain.StatusDisabled {
			if err := requireNoManagedReferences(tx, s.uow, s.table, id, true); err != nil {
				return err
			}
		} else if err := s.validate(tx, &item, old); err != nil {
			return err
		}
		out = &item
		return s.save(tx, actor, &item, old, "status")
	})
	return out, err
}

func requireNoManagedReferences(ctx context.Context, uow domain.ManagedUnitOfWork, table string, id uuid.UUID, activeOnly bool) error {
	linked, err := uow.HasReferences(ctx, table, id, activeOnly)
	if err != nil {
		return err
	}
	if linked {
		return domain.ErrManagedReference
	}
	return nil
}

func (s *managedService[T, P]) Delete(ctx context.Context, actor, id uuid.UUID, version int64) error {
	return s.uow.Write(ctx, func(tx context.Context) error {
		old, err := s.loadForWrite(tx, id, version)
		if err != nil {
			return err
		}
		if err := requireNoManagedReferences(tx, s.uow, s.table, id, false); err != nil {
			return err
		}
		if err := s.repo.Delete(tx, id); err != nil {
			return err
		}
		return writeManagedAudit(tx, s.uow, actor, s.table, id, "delete", auditValues(P(old).ManagedFields()), auditValues(nil))
	})
}
