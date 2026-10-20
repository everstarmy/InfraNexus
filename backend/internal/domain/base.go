package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BaseEntity 领域模型通用基类，全表主键统一使用 UUID
type BaseEntity struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// BeforeCreate 自动发号钩子 (优先生成有序 UUIDv7 或标准 UUID)
func (b *BaseEntity) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}

// Repository 泛型仓储通用接口定义 (Go 1.27+)
type Repository[T any, ID comparable] interface {
	GetByID(ctx context.Context, id ID) (*T, error)
	List(ctx context.Context, page, pageSize int, filters map[string]any) ([]T, int64, error)
	Create(ctx context.Context, entity *T) error
	Update(ctx context.Context, entity *T) error
	Delete(ctx context.Context, id ID) error
}
