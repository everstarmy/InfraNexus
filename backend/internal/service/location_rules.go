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

func DatacenterRule(users domain.UserRepository) ManagedRule[domain.Datacenter] {
	return func(ctx context.Context, item, _ *domain.Datacenter) error {
		if item.OwnerID == nil {
			return nil
		}
		return activeOwner(ctx, users, *item.OwnerID)
	}
}

func TemporaryLocationRule(uow domain.ManagedUnitOfWork, centers domain.ManagedRepository[domain.Datacenter], users domain.UserRepository) ManagedRule[domain.TemporaryLocation] {
	parent := ManagedParentRule(uow, centers, func(v *domain.TemporaryLocation) uuid.UUID { return v.DatacenterID })
	return func(ctx context.Context, item, old *domain.TemporaryLocation) error {
		if err := parent(ctx, item, old); err != nil {
			return err
		}
		return activeOwner(ctx, users, item.OwnerID)
	}
}

func RoomRule(uow domain.ManagedUnitOfWork, floors domain.ManagedRepository[domain.Floor], buildings domain.ManagedRepository[domain.Building]) ManagedRule[domain.Room] {
	return func(ctx context.Context, item, old *domain.Room) error {
		floor, err := activeManagedParent(ctx, floors, item.FloorID)
		if err != nil {
			return err
		}
		building, err := activeManagedParent(ctx, buildings, floor.BuildingID)
		if err != nil {
			return err
		}
		item.DatacenterID = building.DatacenterID
		if old != nil && old.FloorID != item.FloorID {
			return requireNoManagedReferences(ctx, uow, old.TableName(), old.ID, false)
		}
		return nil
	}
}

func RackRule(uow domain.ManagedUnitOfWork, inventory domain.LocationInventoryRepository, rows domain.ManagedRepository[domain.RackRow], rooms domain.ManagedRepository[domain.Room], zones domain.ManagedRepository[domain.SecurityZone]) ManagedRule[domain.Rack] {
	return func(ctx context.Context, item, old *domain.Rack) error {
		row, err := activeManagedParent(ctx, rows, item.RackRowID)
		if err != nil {
			return err
		}
		item.RoomID = row.RoomID
		if item.SecurityZoneID != nil {
			zone, err := activeManagedParent(ctx, zones, *item.SecurityZoneID)
			if err != nil {
				return err
			}
			room, err := activeManagedParent(ctx, rooms, row.RoomID)
			if err != nil {
				return err
			}
			if zone.DatacenterID != room.DatacenterID {
				return coreerrors.ErrParamInvalid.WithMessage("机柜与安全域须属于同一数据中心")
			}
		}
		if old == nil {
			return nil
		}
		if old.RackRowID != item.RackRowID || !sameManagedID(old.SecurityZoneID, item.SecurityZoneID) {
			if err := requireNoManagedReferences(ctx, uow, old.TableName(), old.ID, false); err != nil {
				return err
			}
		}
		if item.Units < old.Units {
			occupied, err := inventory.RackUnits(ctx, old.ID)
			if err != nil {
				return err
			}
			if len(occupied) > 0 && occupied[0].Unit > item.Units {
				return domain.ErrManagedReference
			}
		}
		return nil
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
