package repository

import (
	"context"

	"gorm.io/gorm"
)

// BaseRepository 通用泛型仓储实现 (Go 1.27+)
type BaseRepository[T any, ID comparable] struct {
	db *gorm.DB
}

func NewBaseRepository[T any, ID comparable](db *gorm.DB) *BaseRepository[T, ID] {
	return &BaseRepository[T, ID]{db: db}
}

func (r *BaseRepository[T, ID]) DB(ctx context.Context) *gorm.DB {
	return r.db.WithContext(ctx)
}

func (r *BaseRepository[T, ID]) GetByID(ctx context.Context, id ID) (*T, error) {
	var entity T
	if err := r.DB(ctx).First(&entity, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &entity, nil
}

func (r *BaseRepository[T, ID]) List(ctx context.Context, page, pageSize int, filters map[string]any) ([]T, int64, error) {
	var items []T
	var total int64

	query := r.DB(ctx).Model(new(T))
	for k, v := range filters {
		if v != nil && v != "" {
			query = query.Where(k, v)
		}
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if page > 0 && pageSize > 0 {
		offset := (page - 1) * pageSize
		query = query.Offset(offset).Limit(pageSize)
	}

	if err := query.Find(&items).Error; err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

func (r *BaseRepository[T, ID]) Create(ctx context.Context, entity *T) error {
	return r.DB(ctx).Create(entity).Error
}

func (r *BaseRepository[T, ID]) Update(ctx context.Context, entity *T) error {
	return r.DB(ctx).Save(entity).Error
}

func (r *BaseRepository[T, ID]) Delete(ctx context.Context, id ID) error {
	var entity T
	return r.DB(ctx).Delete(&entity, "id = ?", id).Error
}
