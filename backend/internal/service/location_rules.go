package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

func activeOwner(ctx context.Context, users domain.UserRepository, id uuid.UUID) error {
	user, err := users.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && user.Status != domain.StatusEnabled {
		return coreerrors.ErrResourceConflict.WithMessage("责任人不存在或已停用")
	}
	return err
}

func LocationDatacenterRule[T any, P domain.ManagedEntity[T]](nodes domain.LocationNodeRepository, uow domain.ManagedUnitOfWork, parentID func(*T) uuid.UUID) ManagedRule[T] {
	return func(ctx context.Context, item, old *T) error {
		if old != nil && parentID(old) != parentID(item) {
			if err := requireNoManagedReferences(ctx, uow, P(old).TableName(), P(old).ManagedFields().ID, false); err != nil {
				return err
			}
		}
		node, err := nodes.Get(ctx, parentID(item))
		if errors.Is(err, domain.ErrManagedNotFound) || err == nil && (node.Type != domain.LocationDatacenter || node.Status != domain.StatusEnabled) {
			return coreerrors.ErrResourceConflict.WithMessage("数据中心不存在或已停用")
		}
		return err
	}
}

func TemporaryLocationRule(nodes domain.LocationNodeRepository, uow domain.ManagedUnitOfWork, users domain.UserRepository) ManagedRule[domain.TemporaryLocation] {
	parent := LocationDatacenterRule(nodes, uow, func(v *domain.TemporaryLocation) uuid.UUID { return v.DatacenterID })
	return func(ctx context.Context, item, old *domain.TemporaryLocation) error {
		if err := parent(ctx, item, old); err != nil {
			return err
		}
		return activeOwner(ctx, users, item.OwnerID)
	}
}

func ShelfRule(uow domain.ManagedUnitOfWork, inventory domain.LocationInventoryRepository, warehouses domain.ManagedRepository[domain.Warehouse]) ManagedRule[domain.Shelf] {
	parent := ManagedParentRule(uow, warehouses, func(v *domain.Shelf) uuid.UUID { return v.WarehouseID })
	return func(ctx context.Context, item, old *domain.Shelf) error {
		if err := parent(ctx, item, old); err != nil {
			return err
		}
		if old == nil || item.LayerCount >= old.LayerCount {
			return nil
		}
		maxLayer, err := inventory.MaxBinLayer(ctx, old.ID)
		if err != nil {
			return err
		}
		if maxLayer > item.LayerCount {
			return domain.ErrManagedReference
		}
		return nil
	}
}

func BinRule(shelves domain.ManagedRepository[domain.Shelf]) ManagedRule[domain.Bin] {
	return func(ctx context.Context, item, _ *domain.Bin) error {
		shelf, err := activeManagedParent(ctx, shelves, item.ShelfID)
		if err != nil {
			return err
		}
		if item.Layer > shelf.LayerCount {
			return coreerrors.ErrParamInvalid.WithMessage("库位层号超过货架层数")
		}
		return nil
	}
}
