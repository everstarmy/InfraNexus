package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type ldapRepository struct {
	db *gorm.DB
}

func NewLDAPRepository(db *gorm.DB) domain.LDAPRepository {
	return &ldapRepository{db: db}
}

func (r *ldapRepository) DB(ctx context.Context) *gorm.DB {
	return r.db.WithContext(ctx)
}

func (r *ldapRepository) ListConfigs(ctx context.Context) ([]domain.LDAPConfig, error) {
	var configs []domain.LDAPConfig
	err := r.DB(ctx).Order("created_at ASC").Find(&configs).Error
	return configs, err
}

func (r *ldapRepository) GetConfig(ctx context.Context, id uuid.UUID) (*domain.LDAPConfig, error) {
	var cfg domain.LDAPConfig
	if err := r.DB(ctx).First(&cfg, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (r *ldapRepository) GetConfigByDomain(ctx context.Context, domainName string) (*domain.LDAPConfig, error) {
	var cfg domain.LDAPConfig
	if err := r.DB(ctx).First(&cfg, "domain = ?", domainName).Error; err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (r *ldapRepository) CreateConfig(ctx context.Context, cfg *domain.LDAPConfig) error {
	return r.DB(ctx).Create(cfg).Error
}

func (r *ldapRepository) SaveConfig(ctx context.Context, cfg *domain.LDAPConfig) error {
	return r.DB(ctx).Model(cfg).Select(
		"name", "type", "domain", "server_host", "port", "use_ssl", "start_tls", "insecure_skip_verify",
		"bind_dn", "bind_password", "base_dn", "user_filter", "attribute_mapping", "department_sync",
		"default_role_id", "enabled", "sync_enabled", "sync_interval_minutes", "disable_missing_users", "timeout_seconds",
	).Updates(cfg).Error
}

func (r *ldapRepository) DeleteConfig(ctx context.Context, id uuid.UUID, now time.Time) error {
	result := r.DB(ctx).
		Where("id = ? AND NOT (sync_status = ? AND sync_lease_expires_at IS NOT NULL AND sync_lease_expires_at > ?)", id, domain.SyncStatusRunning, now).
		Delete(&domain.LDAPConfig{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		if _, err := r.GetConfig(ctx, id); err != nil {
			return err
		}
		return domain.ErrDirectorySyncActive
	}
	return nil
}

func (r *ldapRepository) TryAcquireSync(ctx context.Context, id, taskID uuid.UUID, configRevision, now, leaseExpiresAt time.Time) (bool, error) {
	result := r.DB(ctx).Model(&domain.LDAPConfig{}).
		Where("id = ? AND updated_at = ? AND (sync_status <> ? OR sync_lease_expires_at IS NULL OR sync_lease_expires_at <= ?)", id, configRevision, domain.SyncStatusRunning, now).
		Updates(map[string]any{"sync_status": domain.SyncStatusRunning, "sync_started_at": now, "sync_task_id": taskID, "sync_lease_expires_at": leaseExpiresAt})
	return result.RowsAffected == 1, result.Error
}

func (r *ldapRepository) CreateSyncTask(ctx context.Context, configID uuid.UUID, configRevision, now, leaseExpiresAt time.Time, log *domain.LDAPSyncLog) (bool, error) {
	acquired := false
	err := r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&domain.LDAPConfig{}).
			Where("id = ? AND updated_at = ? AND (sync_status <> ? OR sync_lease_expires_at IS NULL OR sync_lease_expires_at <= ?)", configID, configRevision, domain.SyncStatusRunning, now).
			Updates(map[string]any{"sync_status": domain.SyncStatusRunning, "sync_started_at": now, "sync_task_id": log.ID, "sync_lease_expires_at": leaseExpiresAt})
		if result.Error != nil || result.RowsAffected != 1 {
			return result.Error
		}
		if err := tx.Create(log).Error; err != nil {
			return err
		}
		acquired = true
		return nil
	})
	return acquired, err
}

func (r *ldapRepository) RenewSyncLease(ctx context.Context, id, taskID uuid.UUID, now, leaseExpiresAt time.Time) (bool, error) {
	result := r.DB(ctx).Model(&domain.LDAPConfig{}).
		Where("id = ? AND sync_status = ? AND sync_task_id = ? AND sync_lease_expires_at > ?", id, domain.SyncStatusRunning, taskID, now).
		Update("sync_lease_expires_at", leaseExpiresAt)
	return result.RowsAffected == 1, result.Error
}

func (r *ldapRepository) ReleaseSync(ctx context.Context, id, taskID uuid.UUID, status string, finishedAt time.Time, successAt *time.Time) (bool, error) {
	values := map[string]any{"sync_status": status, "last_sync_at": finishedAt, "sync_task_id": nil, "sync_lease_expires_at": nil}
	if successAt != nil {
		values["last_success_at"] = *successAt
	}
	result := r.DB(ctx).Model(&domain.LDAPConfig{}).Where("id = ? AND sync_status = ? AND sync_task_id = ? AND sync_lease_expires_at > ?", id, domain.SyncStatusRunning, taskID, finishedAt).Updates(values)
	return result.RowsAffected == 1, result.Error
}

func (r *ldapRepository) CreateLog(ctx context.Context, log *domain.LDAPSyncLog) error {
	return r.DB(ctx).Create(log).Error
}

func (r *ldapRepository) SaveLogIfOwner(ctx context.Context, log *domain.LDAPSyncLog, now time.Time) (bool, error) {
	result := r.DB(ctx).Model(&domain.LDAPSyncLog{}).
		Where("id = ? AND config_id = ? AND status = ? AND EXISTS (SELECT 1 FROM ldap_configs WHERE ldap_configs.id = ? AND ldap_configs.sync_status = ? AND ldap_configs.sync_task_id = ? AND ldap_configs.sync_lease_expires_at > ?)",
			log.ID, log.ConfigID, domain.SyncStatusRunning, log.ConfigID, domain.SyncStatusRunning, log.ID, now).
		Updates(map[string]any{
			"phase": log.Phase, "processed": log.Processed, "total": log.Total, "report": log.Report,
			"status": log.Status, "finished_at": log.FinishedAt, "duration_ms": log.DurationMs, "message": log.Message,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *ldapRepository) GetLog(ctx context.Context, id uuid.UUID) (*domain.LDAPSyncLog, error) {
	var log domain.LDAPSyncLog
	if err := r.DB(ctx).First(&log, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &log, nil
}

func (r *ldapRepository) GetLogByIdempotency(ctx context.Context, configID, operatorID uuid.UUID, key string) (*domain.LDAPSyncLog, error) {
	var log domain.LDAPSyncLog
	if err := r.DB(ctx).First(&log, "config_id = ? AND operator_id = ? AND idempotency_key = ?", configID, operatorID, key).Error; err != nil {
		return nil, err
	}
	return &log, nil
}

func (r *ldapRepository) CreatePlan(ctx context.Context, plan *domain.LDAPSyncPlanSnapshot) error {
	return r.DB(ctx).Create(plan).Error
}

func (r *ldapRepository) GetPlan(ctx context.Context, id uuid.UUID) (*domain.LDAPSyncPlanSnapshot, error) {
	var plan domain.LDAPSyncPlanSnapshot
	if err := r.DB(ctx).First(&plan, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}

func (r *ldapRepository) ListPlanItems(ctx context.Context, id uuid.UUID, page, pageSize int) ([]domain.SyncPlanItem, int64, error) {
	plan, err := r.GetPlan(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	items := plan.Items.Data()
	total := int64(len(items))
	if page < 1 || pageSize < 1 {
		return items, total, nil
	}
	start := (page - 1) * pageSize
	if start >= len(items) {
		return []domain.SyncPlanItem{}, total, nil
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return items[start:end], total, nil
}

func (r *ldapRepository) DeleteExpiredPlans(ctx context.Context, now time.Time) (int64, error) {
	result := r.DB(ctx).Unscoped().Where("expires_at <= ?", now).Delete(&domain.LDAPSyncPlanSnapshot{})
	return result.RowsAffected, result.Error
}

func (r *ldapRepository) RecoverExpiredSyncs(ctx context.Context, now time.Time) error {
	return r.DB(ctx).Transaction(func(tx *gorm.DB) error {
		var configs []domain.LDAPConfig
		if err := tx.Where("sync_status = ? AND (sync_lease_expires_at IS NULL OR sync_lease_expires_at <= ?)", domain.SyncStatusRunning, now).Find(&configs).Error; err != nil {
			return err
		}
		for _, cfg := range configs {
			if cfg.SyncTaskID != nil {
				finished := now
				message := "服务实例中断，任务已停止；请重新预览后重试"
				if err := tx.Model(&domain.LDAPSyncLog{}).
					Where("id = ? AND config_id = ? AND status = ?", *cfg.SyncTaskID, cfg.ID, domain.SyncStatusRunning).
					Updates(map[string]any{"status": domain.SyncStatusFailed, "phase": domain.SyncPhaseFinalizing, "finished_at": finished, "message": message}).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&domain.LDAPConfig{}).
				Where("id = ? AND sync_status = ? AND sync_task_id = ?", cfg.ID, domain.SyncStatusRunning, cfg.SyncTaskID).
				Updates(map[string]any{"sync_status": domain.SyncStatusFailed, "last_sync_at": now, "sync_task_id": nil, "sync_lease_expires_at": nil}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *ldapRepository) ListLogs(ctx context.Context, configID *uuid.UUID, page, pageSize int) ([]domain.LDAPSyncLog, int64, error) {
	var logs []domain.LDAPSyncLog
	var total int64
	query := r.DB(ctx).Model(&domain.LDAPSyncLog{})
	if configID != nil {
		query = query.Where("config_id = ?", *configID)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if page > 0 && pageSize > 0 {
		query = query.Offset((page - 1) * pageSize).Limit(pageSize)
	}
	err := query.Order("started_at DESC").Find(&logs).Error
	return logs, total, err
}
