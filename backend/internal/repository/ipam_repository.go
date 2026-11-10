package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type addressPoolRepository struct {
	base *BaseRepository[domain.IPAddress, uuid.UUID]
}

func NewAddressPoolRepository(db *gorm.DB) domain.AddressPoolRepository {
	return &addressPoolRepository{base: NewBaseRepository[domain.IPAddress, uuid.UUID](db)}
}
func (r *addressPoolRepository) Find(ctx context.Context, subnet uuid.UUID, number int64) (*domain.IPAddress, error) {
	var row domain.IPAddress
	err := r.base.DB(ctx).First(&row, "subnet_id = ? AND ip_integer = ?", subnet, number).Error
	return &row, err
}
func (r *addressPoolRepository) Range(ctx context.Context, subnet uuid.UUID, first, last int64) ([]domain.IPAddress, map[uuid.UUID]bool, error) {
	type projection struct {
		domain.IPAddress
		Conflicted bool
	}
	var found []projection
	err := r.base.DB(ctx).Model(&domain.IPAddress{}).
		Select(`ipam_ip_address.*, EXISTS (
			SELECT 1 FROM ipam_conflict c
			WHERE c.address_id = ipam_ip_address.id AND c.resolved_at IS NULL AND c.deleted_at IS NULL
		) AS conflicted`).
		Where("subnet_id = ? AND ip_integer BETWEEN ? AND ?", subnet, first, last).Find(&found).Error
	if err != nil {
		return nil, nil, err
	}
	rows := make([]domain.IPAddress, 0, len(found))
	active := make(map[uuid.UUID]bool, len(found))
	for _, row := range found {
		rows = append(rows, row.IPAddress)
		active[row.ID] = row.Conflicted
	}
	return rows, active, nil
}

func (r *addressPoolRepository) Create(ctx context.Context, row *domain.IPAddress) error {
	return r.base.Create(ctx, row)
}
func (r *addressPoolRepository) Update(ctx context.Context, row *domain.IPAddress) error {
	result := r.base.DB(ctx).Model(&domain.IPAddress{}).Where("id = ? AND version = ?", row.ID, row.Version-1).
		Select("manually_reserved", "version", "updated_at").Updates(row)
	if result.Error == nil && result.RowsAffected != 1 {
		return domain.ErrEditRevisionConflict
	}
	return result.Error
}
func (r *addressPoolRepository) Conflicts(ctx context.Context, address uuid.UUID, q domain.ManagedQuery) ([]domain.IPConflict, int64, error) {
	return managedPage[domain.IPConflict](r.base.DB(ctx).Model(&domain.IPConflict{}).Where("address_id = ?", address), q, "observed_at DESC, id DESC")
}
func (r *addressPoolRepository) CreateConflict(ctx context.Context, row *domain.IPConflict) error {
	return r.base.DB(ctx).Create(row).Error
}
func (r *addressPoolRepository) ResolveConflict(ctx context.Context, id, address, actor uuid.UUID, reason string, at time.Time) (bool, error) {
	db := r.base.DB(ctx)
	result := db.Model(&domain.IPConflict{}).Where("id = ? AND address_id = ? AND resolved_at IS NULL", id, address).
		Updates(map[string]any{"resolved_at": at, "resolved_by": actor, "resolution_reason": reason})
	if result.Error != nil || result.RowsAffected != 0 {
		return result.RowsAffected != 0, result.Error
	}
	var existing domain.IPConflict
	return false, db.First(&existing, "id = ? AND address_id = ?", id, address).Error
}

type subnetOverlapRepository struct {
	*BaseRepository[domain.Subnet, uuid.UUID]
}

func NewSubnetOverlapRepository(db *gorm.DB) domain.SubnetOverlapRepository {
	return &subnetOverlapRepository{BaseRepository: NewBaseRepository[domain.Subnet, uuid.UUID](db)}
}
func (r *subnetOverlapRepository) SubnetOverlaps(ctx context.Context, scope, id uuid.UUID, cidr string) (bool, error) {
	var overlaps bool
	err := r.DB(ctx).Raw(`SELECT EXISTS (
		SELECT 1 FROM ipam_subnet
		WHERE network_scope_id = ? AND id <> ? AND is_allocatable AND cidr && CAST(? AS cidr)
	)`, scope, id, cidr).Scan(&overlaps).Error
	return overlaps, err
}

func NewSubnetRepository(db *gorm.DB) domain.ManagedRepository[domain.Subnet] {
	repo := newManagedRepository[domain.Subnet](db, "network_scope_id")
	parent := repo.filter
	repo.filter = func(query *gorm.DB, filters domain.ManagedQuery) *gorm.DB {
		query = parent(query, filters)
		if filters.SecurityZoneID != nil {
			query = query.Where("security_zone_id = ?", *filters.SecurityZoneID)
		}
		return filterSubnetUsage(query, filters)
	}
	return repo
}

func NewRackSubnetBindingRepository(db *gorm.DB) domain.ManagedRepository[domain.RackSubnetBinding] {
	repo := newManagedRepository[domain.RackSubnetBinding](db, "rack_id")
	parent := repo.filter
	repo.order = "is_default DESC, code, id"
	repo.filter = func(query *gorm.DB, filters domain.ManagedQuery) *gorm.DB {
		return filterSubnetUsage(parent(query, filters), filters)
	}
	return repo
}

func filterSubnetUsage(query *gorm.DB, filters domain.ManagedQuery) *gorm.DB {
	if filters.UsageType == "" {
		return query
	}
	return query.Where("usage_type = ?", filters.UsageType)
}
