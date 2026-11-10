package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

func activeManagedParent[T any, P domain.ManagedEntity[T]](ctx context.Context, repo domain.ManagedRepository[T], id uuid.UUID) (*T, error) {
	item, err := repo.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && P(item).ManagedFields().Status != domain.StatusEnabled {
		return nil, coreerrors.ErrResourceConflict.WithMessage("关联对象不存在或已停用")
	}
	return item, err
}

func ManagedParentRule[T any, P domain.ManagedEntity[T], R any, Q domain.ManagedEntity[R]](
	uow domain.ManagedUnitOfWork, parents domain.ManagedRepository[R], parentID func(*T) uuid.UUID,
) ManagedRule[T] {
	return func(ctx context.Context, item, old *T) error {
		if old != nil && parentID(old) != parentID(item) {
			if err := requireNoManagedReferences(ctx, uow, P(old).TableName(), P(old).ManagedFields().ID, false); err != nil {
				return err
			}
		}
		_, err := activeManagedParent[R, Q](ctx, parents, parentID(item))
		return err
	}
}

func sameManagedID(a, b *uuid.UUID) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
