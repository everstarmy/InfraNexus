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

func (r *ldapRepository) DeleteConfig(ctx context.Context, id uuid.UUID) error {
	return r.DB(ctx).Delete(&domain.LDAPConfig{}, "id = ?", id).Error
}

func (r *ldapRepository) TryAcquireSync(ctx context.Context, id uuid.UUID, now, staleBefore time.Time) (bool, error) {
	result := r.DB(ctx).Model(&domain.LDAPConfig{}).
		Where("id = ? AND (sync_status <> ? OR sync_started_at IS NULL OR sync_started_at < ?)", id, domain.SyncStatusRunning, staleBefore).
		Updates(map[string]any{"sync_status": domain.SyncStatusRunning, "sync_started_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *ldapRepository) ReleaseSync(ctx context.Context, id uuid.UUID, status string, finishedAt time.Time, successAt *time.Time) error {
	values := map[string]any{"sync_status": status, "last_sync_at": finishedAt}
	if successAt != nil {
		values["last_success_at"] = *successAt
	}
	return r.DB(ctx).Model(&domain.LDAPConfig{}).Where("id = ?", id).Updates(values).Error
}

func (r *ldapRepository) CreateLog(ctx context.Context, log *domain.LDAPSyncLog) error {
	return r.DB(ctx).Create(log).Error
}

func (r *ldapRepository) SaveLog(ctx context.Context, log *domain.LDAPSyncLog) error {
	return r.DB(ctx).Save(log).Error
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
