package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type locationNodeRepository struct {
	*BaseRepository[domain.LocationNode, uuid.UUID]
}

func NewLocationNodeRepository(db *gorm.DB) domain.LocationNodeRepository {
	return &locationNodeRepository{NewBaseRepository[domain.LocationNode, uuid.UUID](db)}
}

func (r *locationNodeRepository) Transaction(ctx context.Context, fn func(context.Context) error) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(2026111107)).Error; err != nil {
			return err
		}
		return fn(contextWithTransaction(ctx, tx))
	})
}

func (r *locationNodeRepository) Get(ctx context.Context, uid uuid.UUID) (domain.LocationNode, error) {
	var node domain.LocationNode
	err := r.DB(ctx).Select("dc_location.*, (SELECT security_zone_id FROM dc_rack_security_zone WHERE rack_id = dc_location.uid) AS security_zone_id").First(&node, "uid = ?", uid).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = domain.ErrManagedNotFound
	}
	return node, err
}

func (r *locationNodeRepository) GetType(ctx context.Context, uid uuid.UUID) (domain.LocationType, error) {
	var node domain.LocationNode
	err := r.DB(ctx).Unscoped().Select("type").First(&node, "uid = ?", uid).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = domain.ErrManagedNotFound
	}
	return node.Type, err
}

func (r *locationNodeRepository) List(ctx context.Context, q domain.LocationNodeQuery) ([]domain.LocationNode, int64, error) {
	nodes := make([]domain.LocationNode, 0)
	if len(q.Types) == 0 {
		return nodes, 0, nil
	}
	query := r.DB(ctx).Model(&domain.LocationNode{}).Where("type IN ?", q.Types)
	if !q.AcrossParents {
		if q.Parent == nil {
			query = query.Where("parent IS NULL")
		} else {
			query = query.Where("parent = ?", *q.Parent)
		}
	}
	if q.Status != 0 {
		query = query.Where("status = ?", q.Status)
	}
	if q.Floor != nil {
		query = query.Where("type = 'room' AND ext->>'floor' = ?", fmt.Sprint(*q.Floor))
	}
	if q.Row != "" {
		query = query.Where("type = 'rack' AND ext->>'row' = ?", q.Row)
	}
	if q.Column != nil {
		query = query.Where("type = 'rack' AND ext->>'column' = ?", fmt.Sprint(*q.Column))
	}
	if q.Search != "" {
		query = query.Where("strpos(lower(name), lower(?)) > 0", q.Search)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size := min(max(1, q.PageSize), 100)
	visible := q.VisibleTypes
	if len(visible) == 0 {
		visible = q.Types
	}
	query = query.Select(`dc_location.*,
        (SELECT security_zone_id FROM dc_rack_security_zone WHERE rack_id = dc_location.uid) AS security_zone_id,
        EXISTS (SELECT 1 FROM dc_location child WHERE child.parent = dc_location.uid
            AND child.deleted_at IS NULL AND child.type IN ?) AS has_children,
        (WITH RECURSIVE ancestors AS (
            SELECT root.uid, root.name, root.parent, root.type, 1 AS depth FROM dc_location root WHERE root.uid = dc_location.parent
            UNION ALL SELECT p.uid, p.name, p.parent, p.type, a.depth + 1
            FROM dc_location p JOIN ancestors a ON p.uid = a.parent
        ) SELECT coalesce(jsonb_agg(jsonb_build_object('uid', uid, 'name', name, 'type', type)
            ORDER BY depth DESC) FILTER (WHERE type IN ?), '[]'::jsonb) FROM ancestors) AS path`, visible, visible)
	err := query.Order("name, uid").Offset((max(1, q.Page) - 1) * size).Limit(size).Find(&nodes).Error
	return nodes, total, err
}

func (r *locationNodeRepository) Create(ctx context.Context, node *domain.LocationNode) error {
	return r.DB(ctx).Create(node).Error
}

func (r *locationNodeRepository) Update(ctx context.Context, node *domain.LocationNode, expected int64) error {
	result := r.DB(ctx).Model(node).Where("version = ?", expected).
		Select("name", "ext", "status", "version", "updated_at", "deleted_at").Updates(node)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrEditRevisionConflict
	}
	return nil
}

func (r *locationNodeRepository) SetRackSecurityZone(ctx context.Context, uid uuid.UUID, zone *uuid.UUID) error {
	db := r.DB(ctx)
	if zone == nil {
		return db.Exec("DELETE FROM dc_rack_security_zone WHERE rack_id = ?", uid).Error
	}
	result := db.Exec(`
WITH RECURSIVE ancestors AS (
    SELECT uid, parent, type FROM dc_location WHERE uid = ?
    UNION ALL
    SELECT p.uid, p.parent, p.type FROM dc_location p JOIN ancestors a ON p.uid = a.parent
)
INSERT INTO dc_rack_security_zone (rack_id, security_zone_id)
SELECT ?, z.id FROM ipam_security_zone z JOIN ancestors a ON a.uid = z.datacenter_id
WHERE z.id = ? AND a.type = 'datacenter' AND z.deleted_at IS NULL AND z.status = 1
ON CONFLICT (rack_id) DO UPDATE SET security_zone_id = EXCLUDED.security_zone_id
`, uid, uid, *zone)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return coreerrors.ErrResourceConflict.WithMessage("安全域须已启用且与机柜同属数据中心")
	}
	return nil
}
