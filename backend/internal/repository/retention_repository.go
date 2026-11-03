package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"infranexus/internal/domain"
)

type retentionRepository struct{ db *gorm.DB }

func NewRetentionRepository(db *gorm.DB) domain.RetentionRepository { return &retentionRepository{db} }
func (r *retentionRepository) Cleanup(ctx context.Context, outboxBefore, logsBefore time.Time, limit int) (int64, error) {
	limit = min(max(limit, 1), 500)
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var ids []uuid.UUID
		if err := tx.Unscoped().Model(&domain.AuthorizationOutbox{}).Where("processed_at < ?", outboxBefore).Order("processed_at ASC").Limit(limit).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) > 0 {
			result := tx.Unscoped().Where("id IN ? AND processed_at < ?", ids, outboxBefore).Delete(&domain.AuthorizationOutbox{})
			if result.Error != nil {
				return result.Error
			}
			total += result.RowsAffected
		}
		ids = nil
		// Retain nonterminal tasks and every task still referenced by an active lease.
		query := tx.Unscoped().Model(&domain.LDAPSyncLog{}).Where("status IN ? AND finished_at < ?", []string{domain.SyncStatusSuccess, domain.SyncStatusPartial, domain.SyncStatusFailed}, logsBefore).
			Where("NOT EXISTS (SELECT 1 FROM ldap_configs WHERE ldap_configs.sync_task_id = ldap_sync_logs.id AND ldap_configs.sync_status = ?)", domain.SyncStatusRunning)
		if err := query.Order("finished_at ASC").Limit(limit).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) > 0 {
			result := tx.Unscoped().Where("id IN ?", ids).Delete(&domain.LDAPSyncLog{})
			if result.Error != nil {
				return result.Error
			}
			total += result.RowsAffected
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return total, nil
}
