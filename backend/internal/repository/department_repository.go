package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type departmentRepository struct {
	*BaseRepository[domain.Department, uuid.UUID]
}

func NewDepartmentRepository(db *gorm.DB) domain.DepartmentRepository {
	return &departmentRepository{
		BaseRepository: NewBaseRepository[domain.Department, uuid.UUID](db),
	}
}

func (r *departmentRepository) ListAll(ctx context.Context) ([]domain.Department, error) {
	var depts []domain.Department
	if err := r.DB(ctx).Order("sort_order ASC, created_at ASC").Find(&depts).Error; err != nil {
		return nil, err
	}
	return depts, nil
}

func (r *departmentRepository) GetByCode(ctx context.Context, code string) (*domain.Department, error) {
	var dept domain.Department
	if err := r.DB(ctx).First(&dept, "code = ?", code).Error; err != nil {
		return nil, err
	}
	return &dept, nil
}

func (r *departmentRepository) GetByExternalID(ctx context.Context, source, externalID string) (*domain.Department, error) {
	var dept domain.Department
	if err := r.DB(ctx).First(&dept, "source = ? AND external_id = ?", source, externalID).Error; err != nil {
		return nil, err
	}
	return &dept, nil
}

func (r *departmentRepository) FindChildByName(ctx context.Context, parentID *uuid.UUID, name string) (*domain.Department, error) {
	query := r.DB(ctx).Where("name = ?", name)
	if parentID == nil {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id = ?", *parentID)
	}
	var dept domain.Department
	if err := query.First(&dept).Error; err != nil {
		return nil, err
	}
	return &dept, nil
}

func (r *departmentRepository) CountChildren(ctx context.Context, id uuid.UUID) (int64, error) {
	var count int64
	err := r.DB(ctx).Model(&domain.Department{}).Where("parent_id = ?", id).Count(&count).Error
	return count, err
}

func (r *departmentRepository) ListSubtree(ctx context.Context, treePath string) ([]domain.Department, error) {
	var depts []domain.Department
	err := r.DB(ctx).Where("tree_path = ? OR tree_path LIKE ?", treePath, treePath+"/%").Find(&depts).Error
	return depts, err
}

func (r *departmentRepository) Move(ctx context.Context, id uuid.UUID, parentID *uuid.UUID, oldPath, newPath string) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&domain.Department{}).Where("id = ?", id).Updates(map[string]any{
			"parent_id": parentID,
			"tree_path": newPath,
		}).Error; err != nil {
			return err
		}
		return tx.Exec(
			"UPDATE departments SET tree_path = ? || SUBSTR(tree_path, ?) WHERE tree_path LIKE ?",
			newPath, len(oldPath)+1, oldPath+"/%",
		).Error
	})
}

func (r *departmentRepository) Reorder(ctx context.Context, items []domain.DepartmentOrder) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		for _, item := range items {
			if err := tx.Model(&domain.Department{}).Where("id = ?", item.ID).Update("sort_order", item.SortOrder).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
