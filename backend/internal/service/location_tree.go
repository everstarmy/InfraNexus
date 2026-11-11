package service

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type locationTreeService struct {
	domain.LocationNodeRepository
	inventory domain.LocationInventoryRepository
	uow       domain.ManagedUnitOfWork
}

func NewLocationTreeService(repo domain.LocationNodeRepository, inventory domain.LocationInventoryRepository, uow domain.ManagedUnitOfWork) domain.LocationTreeService {
	return &locationTreeService{repo, inventory, uow}
}

func (s *locationTreeService) validateParent(ctx context.Context, fields domain.LocationFields, uid uuid.UUID) error {
	if fields.Parent == nil {
		return nil
	}
	if *fields.Parent == uid {
		return coreerrors.ErrParamInvalid.WithMessage("节点不能作为自己的上级")
	}
	expected, _ := fields.Type.ParentType()
	parent, err := s.Get(ctx, *fields.Parent)
	if errors.Is(err, domain.ErrManagedNotFound) || err == nil && (parent.Type != expected || parent.Status != domain.StatusEnabled) {
		return coreerrors.ErrResourceConflict.WithMessage("上级不存在、已停用或层级不符")
	}
	return err
}

func (s *locationTreeService) Create(ctx context.Context, actor uuid.UUID, key string, fields domain.LocationFields) (node domain.LocationNode, err error) {
	err = s.Transaction(ctx, func(ctx context.Context) error {
		node, err = managedReplay(ctx, s.uow, actor, "dc_location:create", key, fields, func() (domain.LocationNode, error) {
			return s.create(ctx, actor, fields)
		})
		return err
	})
	return node, err
}

func (s *locationTreeService) create(ctx context.Context, actor uuid.UUID, fields domain.LocationFields) (domain.LocationNode, error) {
	fields, err := fields.Normalize()
	if err != nil {
		return domain.LocationNode{}, coreerrors.ErrParamInvalid.WithMessage(err.Error())
	}
	node := domain.LocationNode{UID: uuid.New(), Name: fields.Name, Type: fields.Type, Parent: fields.Parent, Ext: datatypes.JSON(fields.Ext), Status: domain.StatusEnabled, Version: 1}
	if err := s.validateParent(ctx, fields, node.UID); err != nil {
		return node, err
	}
	if err := s.LocationNodeRepository.Create(ctx, &node); err != nil {
		return node, err
	}
	return node, writeManagedAudit(ctx, s.uow, actor, "dc_location", node.UID, "create", domain.ManagedAuditFields{}, locationSnapshot(node))
}

func locationSnapshot(node domain.LocationNode) domain.ManagedAuditFields {
	return domain.ManagedAuditFields{Location: &node, Status: node.Status, Version: node.Version}
}

func (s *locationTreeService) History(ctx context.Context, uid uuid.UUID, q domain.ManagedQuery) ([]domain.ManagedAudit, int64, error) {
	return s.uow.History(ctx, "dc_location", uid, q)
}

func (s *locationTreeService) Change(ctx context.Context, actor, uid uuid.UUID, change domain.LocationChange) (domain.LocationNode, error) {
	var node domain.LocationNode
	err := s.Transaction(ctx, func(ctx context.Context) error {
		var err error
		node, err = s.Get(ctx, uid)
		if err != nil {
			return err
		}
		if node.Version != change.Version {
			return domain.ErrEditRevisionConflict
		}
		before := locationSnapshot(node)
		fields := domain.LocationFields{Name: node.Name, Type: node.Type, Parent: node.Parent, Ext: []byte(node.Ext)}
		switch change.Action {
		case "update":
			fields.Name, fields.Ext = change.Name, []byte(change.Ext)
		case "security-zone":
			if node.Type != domain.LocationRack {
				return coreerrors.ErrParamInvalid.WithMessage("仅机柜可设置安全域")
			}
			if err := s.SetRackSecurityZone(ctx, uid, change.SecurityZoneID); err != nil {
				return err
			}
			node.SecurityZoneID = change.SecurityZoneID
		case "status":
			if change.Status != domain.StatusEnabled && change.Status != domain.StatusDisabled {
				return coreerrors.ErrParamInvalid
			}
			node.Status = change.Status
		case "delete":
			node.DeletedAt.Time, node.DeletedAt.Valid = time.Now(), true
		default:
			return coreerrors.ErrParamInvalid
		}
		fields, err = fields.Normalize()
		if err != nil {
			return coreerrors.ErrParamInvalid.WithMessage(err.Error())
		}
		if change.Action == "status" && node.Status == domain.StatusEnabled {
			if err := s.validateParent(ctx, fields, uid); err != nil {
				return err
			}
		}
		node.Name, node.Ext = fields.Name, datatypes.JSON(fields.Ext)
		node.Version++
		if err := s.Update(ctx, &node, change.Version); err != nil {
			return err
		}
		after := locationSnapshot(node)
		if change.Action == "delete" {
			after = domain.ManagedAuditFields{}
		}
		return writeManagedAudit(ctx, s.uow, actor, "dc_location", uid, change.Action, before, after)
	})
	return node, err
}

func (s *locationTreeService) References(ctx context.Context, uid uuid.UUID) ([]domain.ManagedReferenceCount, error) {
	if _, err := s.Get(ctx, uid); err != nil {
		return nil, err
	}
	return s.uow.References(ctx, "dc_location", uid)
}

func (s *locationTreeService) Units(ctx context.Context, uid uuid.UUID) (domain.RackUnitView, error) {
	node, err := s.Get(ctx, uid)
	if err != nil {
		return domain.RackUnitView{}, err
	}
	if node.Type != domain.LocationRack {
		return domain.RackUnitView{}, domain.ErrManagedNotFound
	}
	var ext domain.RackExt
	if err := json.Unmarshal(node.Ext, &ext); err != nil {
		return domain.RackUnitView{}, err
	}
	occupied, err := s.inventory.RackUnits(ctx, uid)
	if err != nil {
		return domain.RackUnitView{}, err
	}
	return rackUnitView(uid, ext.HeightU, node.Status, occupied), nil
}
