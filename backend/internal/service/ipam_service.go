package service

import (
	"context"
	"encoding/binary"
	"errors"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/validator"
	"infranexus/internal/domain"
)

type addressPoolService struct {
	subnets domain.ManagedRepository[domain.Subnet]
	pool    domain.AddressPoolRepository
	uow     domain.ManagedUnitOfWork
}

func NewAddressPoolService(subnets domain.ManagedRepository[domain.Subnet], pool domain.AddressPoolRepository, uow domain.ManagedUnitOfWork) domain.AddressPoolService {
	return &addressPoolService{subnets: subnets, pool: pool, uow: uow}
}
func (s *addressPoolService) subnet(ctx context.Context, id uuid.UUID) (*domain.Subnet, error) {
	subnet, err := s.subnets.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrManagedNotFound
	}
	if err != nil {
		return nil, err
	}
	if !subnet.IsAllocatable {
		return nil, coreerrors.ErrResourceConflict.WithMessage("规划前缀不生成地址池")
	}
	return subnet, nil
}
func numberAddress(number int64) string {
	var octets [4]byte
	binary.BigEndian.PutUint32(octets[:], uint32(number))
	return netip.AddrFrom4(octets).String()
}
func addressView(subnet *domain.Subnet, number int64, row *domain.IPAddress, conflict bool) domain.IPAddressView {
	out := domain.IPAddressView{Address: numberAddress(number), AllocationState: "free", ReservationKind: "none", Conflicted: conflict}
	switch {
	case subnet.PrefixLength <= 30 && number == subnet.NetworkStart:
		out.ReservationKind = "network"
	case subnet.PrefixLength <= 30 && number == subnet.NetworkEnd:
		out.ReservationKind = "broadcast"
	case out.Address == subnet.Gateway:
		out.ReservationKind = "gateway"
	}
	if row != nil {
		out.ID = &row.ID
		out.AllocationState, out.Version, out.CooldownUntil = row.AllocationState, row.Version, row.CooldownUntil
		if row.ManuallyReserved && out.ReservationKind == "none" {
			out.ReservationKind = "manual"
		}
	}
	out.Available = subnet.Status == domain.StatusEnabled && !conflict && out.ReservationKind == "none" && out.AllocationState == "free"
	return out
}
func (s *addressPoolService) List(ctx context.Context, id uuid.UUID, q domain.ManagedQuery) ([]domain.IPAddressView, int64, error) {
	subnet, err := s.subnet(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	total := subnet.NetworkEnd - subnet.NetworkStart + 1
	first := subnet.NetworkStart + int64(q.Page-1)*int64(q.PageSize)
	last := min(subnet.NetworkEnd, first+int64(q.PageSize)-1)
	out := make([]domain.IPAddressView, 0, q.PageSize)
	if first > last {
		return out, total, nil
	}
	rows, conflicts, err := s.pool.Range(ctx, id, first, last)
	if err != nil {
		return nil, 0, err
	}
	byIP := make(map[int64]*domain.IPAddress, len(rows))
	for i := range rows {
		byIP[rows[i].IPInteger] = &rows[i]
	}
	for n := first; n <= last; n++ {
		row := byIP[n]
		out = append(out, addressView(subnet, n, row, row != nil && conflicts[row.ID]))
	}
	return out, total, nil
}
func poolNumber(subnet *domain.Subnet, address string) (int64, error) {
	ip, err := netip.ParseAddr(address)
	if err != nil || !ip.Is4() {
		return 0, coreerrors.ErrParamInvalid.WithMessage("需要合法的 IPv4 地址")
	}
	n := ipv4Number(ip)
	if n < subnet.NetworkStart || n > subnet.NetworkEnd {
		return 0, domain.ErrManagedNotFound
	}
	return n, nil
}
func (s *addressPoolService) location(ctx context.Context, id uuid.UUID, address string) (*domain.Subnet, int64, error) {
	subnet, err := s.subnet(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	n, err := poolNumber(subnet, address)
	return subnet, n, err
}
func (s *addressPoolService) read(ctx context.Context, subnet *domain.Subnet, n int64) (domain.IPAddressView, error) {
	rows, active, err := s.pool.Range(ctx, subnet.ID, n, n)
	if err != nil {
		return domain.IPAddressView{}, err
	}
	if len(rows) == 0 {
		return addressView(subnet, n, nil, false), nil
	}
	return addressView(subnet, n, &rows[0], active[rows[0].ID]), nil
}
func (s *addressPoolService) Detail(ctx context.Context, id uuid.UUID, address string) (domain.IPAddressView, error) {
	subnet, n, err := s.location(ctx, id, address)
	if err != nil {
		return domain.IPAddressView{}, err
	}
	return s.read(ctx, subnet, n)
}
func (s *addressPoolService) newAddress(ctx context.Context, subnet *domain.Subnet, n int64, manual bool) (*domain.IPAddress, error) {
	row := &domain.IPAddress{SubnetID: subnet.ID, NetworkScopeID: subnet.NetworkScopeID, IPInteger: n, AllocationState: "free", ManuallyReserved: manual, Version: 1}
	return row, s.pool.Create(ctx, row)
}
func (s *addressPoolService) Reserve(ctx context.Context, actor, subnetID uuid.UUID, address string, req domain.IPAddressReservationRequest) (out domain.IPAddressView, err error) {
	req.Reason = strings.TrimSpace(req.Reason)
	if err = validator.Validate(&req); err != nil {
		return out, err
	}
	err = s.uow.Write(ctx, func(tx context.Context) error {
		subnet, n, err := s.location(tx, subnetID, address)
		if err != nil {
			return err
		}
		if subnet.Status != domain.StatusEnabled {
			return coreerrors.ErrResourceConflict.WithMessage("子网已停用")
		}
		before, err := s.read(tx, subnet, n)
		if err != nil {
			return err
		}
		if before.Version != *req.ExpectedVersion {
			return domain.ErrEditRevisionConflict
		}
		if before.ReservationKind != "none" && before.ReservationKind != "manual" {
			return coreerrors.ErrResourceConflict.WithMessage("不能修改网络、广播或网关保留地址")
		}
		if before.AllocationState != "free" || *req.Reserved && before.Conflicted {
			return coreerrors.ErrResourceConflict.WithMessage("地址当前状态不允许更改人工保留")
		}
		if (before.ReservationKind == "manual") == *req.Reserved {
			out = before
			return nil
		}
		var row *domain.IPAddress
		if before.ID == nil {
			row, err = s.newAddress(tx, subnet, n, *req.Reserved)
		} else {
			row, err = s.pool.Find(tx, subnet.ID, n)
			if err == nil {
				row.ManuallyReserved = *req.Reserved
				row.Version++
				err = s.pool.Update(tx, row)
			}
		}
		if err != nil {
			return err
		}
		out = addressView(subnet, n, row, before.Conflicted)
		return writeManagedAudit(tx, s.uow, actor, row.TableName(), row.ID, "reservation",
			domain.ManagedAuditFields{Reservation: before.ReservationKind, Version: before.Version},
			domain.ManagedAuditFields{Reservation: out.ReservationKind, Version: row.Version, Reason: req.Reason})
	})
	return out, err
}
func (s *addressPoolService) History(ctx context.Context, id uuid.UUID, address string, q domain.ManagedQuery) ([]domain.ManagedAudit, int64, error) {
	view, err := s.Detail(ctx, id, address)
	if err != nil {
		return nil, 0, err
	}
	if view.ID == nil {
		return []domain.ManagedAudit{}, 0, nil
	}
	return s.uow.History(ctx, (domain.IPAddress{}).TableName(), *view.ID, q)
}
func (s *addressPoolService) Conflicts(ctx context.Context, id uuid.UUID, address string, q domain.ManagedQuery) ([]domain.IPConflict, int64, error) {
	view, err := s.Detail(ctx, id, address)
	if err != nil {
		return nil, 0, err
	}
	if view.ID == nil {
		return []domain.IPConflict{}, 0, nil
	}
	return s.pool.Conflicts(ctx, *view.ID, q)
}
func (s *addressPoolService) ReportConflict(ctx context.Context, actor, id uuid.UUID, address, key string, req domain.IPConflictRequest) (out *domain.IPConflict, err error) {
	req.ObservedIdentity = strings.TrimSpace(req.ObservedIdentity)
	req.EvidenceRef = strings.TrimSpace(req.EvidenceRef)
	if err = validator.Validate(&req); err != nil {
		return nil, err
	}
	if req.ObservedAt.After(time.Now()) {
		return nil, coreerrors.ErrParamInvalid.WithMessage("观测时间不能晚于当前时间")
	}
	err = s.uow.Write(ctx, func(tx context.Context) error {
		subnet, n, err := s.location(tx, id, address)
		if err != nil {
			return err
		}
		out, err = managedReplay(tx, s.uow, actor, "ip-conflict:"+id.String()+":"+numberAddress(n), key, req, func() (*domain.IPConflict, error) {
			row, err := s.pool.Find(tx, id, n)
			var previousVersion int64
			if errors.Is(err, gorm.ErrRecordNotFound) {
				row, err = s.newAddress(tx, subnet, n, false)
			} else if err == nil {
				previousVersion = row.Version
				row.Version++
				err = s.pool.Update(tx, row)
			}
			if err != nil {
				return nil, err
			}
			conflict := &domain.IPConflict{AddressID: row.ID, ObservedIdentity: req.ObservedIdentity, EvidenceRef: req.EvidenceRef, ObservedAt: req.ObservedAt, ReportedBy: actor}
			if err := s.pool.CreateConflict(tx, conflict); err != nil {
				return nil, err
			}
			return conflict, writeManagedAudit(tx, s.uow, actor, row.TableName(), row.ID, "conflict_report", domain.ManagedAuditFields{Version: previousVersion},
				domain.ManagedAuditFields{ConflictID: &conflict.ID, EvidenceRef: req.EvidenceRef, Version: row.Version})
		})
		return err
	})
	return out, err
}
func (s *addressPoolService) ResolveConflict(ctx context.Context, actor, subnetID, conflictID uuid.UUID, address string, req domain.IPConflictResolution) error {
	req.Reason = strings.TrimSpace(req.Reason)
	if err := validator.Validate(&req); err != nil {
		return err
	}
	return s.uow.Write(ctx, func(tx context.Context) error {
		subnet, n, err := s.location(tx, subnetID, address)
		if err != nil {
			return err
		}
		row, err := s.pool.Find(tx, subnet.ID, n)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.ErrManagedNotFound
		}
		if err != nil {
			return err
		}
		changed, err := s.pool.ResolveConflict(tx, conflictID, row.ID, actor, req.Reason, time.Now().UTC())
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.ErrManagedNotFound
		}
		if err != nil || !changed {
			return err
		}
		row.Version++
		if err := s.pool.Update(tx, row); err != nil {
			return err
		}
		return writeManagedAudit(tx, s.uow, actor, row.TableName(), row.ID, "conflict_resolve",
			domain.ManagedAuditFields{ConflictID: &conflictID, Version: row.Version - 1},
			domain.ManagedAuditFields{ConflictID: &conflictID, Reason: req.Reason, Version: row.Version})
	})
}
