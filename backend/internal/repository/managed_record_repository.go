package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type managedRepository[T any, P domain.ManagedEntity[T]] struct {
	*BaseRepository[T, uuid.UUID]
	filter func(*gorm.DB, domain.ManagedQuery) *gorm.DB
}

func NewManagedRepository[T any, P domain.ManagedEntity[T]](db *gorm.DB, parentColumn string) domain.ManagedRepository[T] {
	return newManagedRepository[T, P](db, parentColumn)
}

func newManagedRepository[T any, P domain.ManagedEntity[T]](db *gorm.DB, parentColumn string) *managedRepository[T, P] {
	return &managedRepository[T, P]{
		BaseRepository: NewBaseRepository[T, uuid.UUID](db),
		filter: func(query *gorm.DB, filters domain.ManagedQuery) *gorm.DB {
			if filters.ParentID == nil {
				return query
			}
			if parentColumn == "" {
				return query.Where("FALSE")
			}
			return query.Where(parentColumn+" = ?", *filters.ParentID)
		},
	}
}

func (r *managedRepository[T, P]) List(ctx context.Context, q domain.ManagedQuery) ([]T, int64, error) {
	db := r.DB(ctx).Model(new(T))
	if q.Search != "" {
		pattern := containsPattern(q.Search)
		db = db.Where(`(LOWER(name) LIKE LOWER(?) ESCAPE '\')`, pattern)
	}
	if q.Status != 0 {
		db = db.Where("status = ?", q.Status)
	}
	return managedPage[T](r.filter(db, q), q, "name, created_at, id")
}

func (r *managedRepository[T, P]) Update(ctx context.Context, record *T) error {
	// Unlike Save, Updates cannot recreate a row missing from the target table.
	base := P(record).ManagedFields()
	result := r.DB(ctx).Model(new(T)).Where("id = ? AND version = ?", base.ID, base.Version-1).
		Select("*").Omit("id", "created_at", "deleted_at").Updates(record)
	if result.Error == nil && result.RowsAffected != 1 {
		return domain.ErrEditRevisionConflict
	}
	return result.Error
}

func (r *managedRepository[T, P]) Delete(ctx context.Context, id uuid.UUID) error {
	return r.DB(ctx).Unscoped().Delete(new(T), "id = ?", id).Error
}

func managedPage[T any](db *gorm.DB, q domain.ManagedQuery, order string) ([]T, int64, error) {
	items := make([]T, 0)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := db.Order(order).Offset((q.Page - 1) * q.PageSize).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

type managedUnitOfWork struct{ db *gorm.DB }

func NewManagedUnitOfWork(db *gorm.DB) domain.ManagedUnitOfWork {
	return &managedUnitOfWork{db: db}
}

func (r *managedUnitOfWork) connection(ctx context.Context) *gorm.DB {
	if tx := transactionFromContext(ctx); tx != nil {
		return tx.WithContext(ctx)
	}
	return r.db.WithContext(ctx)
}

func (r *managedUnitOfWork) Write(ctx context.Context, fn func(context.Context) error) error {
	if transactionFromContext(ctx) != nil {
		return fn(ctx)
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// A single transaction lock orders cross-module master-data writes.
		// Readers and platform operations do not acquire this lock.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(738401, 1)").Error; err != nil {
			return err
		}
		return fn(contextWithTransaction(ctx, tx))
	})
}

func (r *managedUnitOfWork) HasReferences(ctx context.Context, table string, id uuid.UUID, activeOnly bool) (bool, error) {
	for _, ref := range domain.ManagedReferences() {
		if ref.Target != table {
			continue
		}
		db := r.connection(ctx).Table(ref.Table).Where(ref.Column+" = ?", id)
		if activeOnly {
			switch ref.Table {
			case "org_company_contact":
				// Contact details remain available after a company is disabled.
				continue
			case "dc_rack_unit_allocation", "dc_rack_security_zone":
				// Every persisted U position is an occupied or reserved slot.
			case "ipam_ip_address":
				// Historical facts survive a stop. Live allocations block it.
				db = db.Where("allocation_state <> ?", "free")
			default:
				db = db.Where("status = ?", domain.StatusEnabled)
			}
		}
		var exists bool
		if err := r.connection(ctx).Raw("SELECT EXISTS (?)", db.Select("1")).Scan(&exists).Error; err != nil {
			return false, err
		}
		if exists {
			return true, nil
		}
	}
	return false, nil
}

func (r *managedUnitOfWork) References(ctx context.Context, table string, id uuid.UUID) ([]domain.ManagedReferenceCount, error) {
	out := make([]domain.ManagedReferenceCount, 0)
	for _, ref := range domain.ManagedReferences() {
		if ref.Target != table {
			continue
		}
		var count int64
		query := r.connection(ctx).Table(ref.Table).Where(ref.Column+" = ?", id)
		if err := query.Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			out = append(out, domain.ManagedReferenceCount{Resource: ref.Table, Field: ref.Column, Count: count})
		}
	}
	return out, nil
}

func (r *managedUnitOfWork) Audit(ctx context.Context, event *domain.ManagedAudit) error {
	return r.connection(ctx).Create(event).Error
}

func (r *managedUnitOfWork) History(ctx context.Context, table string, id uuid.UUID, q domain.ManagedQuery) ([]domain.ManagedAudit, int64, error) {
	db := r.connection(ctx).Model(&domain.ManagedAudit{}).Where("resource = ? AND resource_id = ?", table, id)
	return managedPage[domain.ManagedAudit](db, q, "created_at DESC, id DESC")
}

func (r *managedUnitOfWork) Receipt(ctx context.Context, actor uuid.UUID, operation, key string) (*domain.ManagedReceipt, error) {
	var out domain.ManagedReceipt
	err := r.connection(ctx).First(&out, "actor_id = ? AND operation = ? AND key = ?", actor, operation, key).Error
	return &out, err
}

func (r *managedUnitOfWork) SaveReceipt(ctx context.Context, receipt *domain.ManagedReceipt) error {
	return r.connection(ctx).Create(receipt).Error
}
