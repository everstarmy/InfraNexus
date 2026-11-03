package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"infranexus/internal/domain"
)

const organizationWriteAttempts = 8

type organizationUnitOfWork struct {
	db *gorm.DB
}

func NewOrganizationUnitOfWork(db *gorm.DB) domain.OrganizationUnitOfWork {
	return &organizationUnitOfWork{db: db}
}

func (u *organizationUnitOfWork) Revision(ctx context.Context) (int64, error) {
	var state domain.OrganizationState
	if err := u.db.WithContext(ctx).Select("revision").First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
		return 0, err
	}
	return state.Revision, nil
}

func (u *organizationUnitOfWork) Write(ctx context.Context, expectedRevision *int64, fn func(context.Context) error) (int64, error) {
	if fn == nil {
		return 0, errors.New("organization write callback is required")
	}
	var lastErr error
	for attempt := range organizationWriteAttempts {
		revision, err := u.writeOnce(ctx, expectedRevision, fn)
		if err == nil || !retryableOrganizationWrite(err) || attempt == organizationWriteAttempts-1 {
			return revision, err
		}
		lastErr = err
		delay := time.Duration(attempt+1) * 15 * time.Millisecond
		if delay > 100*time.Millisecond {
			delay = 100 * time.Millisecond
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return 0, ctx.Err()
		case <-timer.C:
		}
	}
	return 0, fmt.Errorf("organization write retries exhausted: %w", lastErr)
}

func (u *organizationUnitOfWork) writeOnce(ctx context.Context, expectedRevision *int64, fn func(context.Context) error) (int64, error) {
	var nextRevision int64
	err := u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&domain.OrganizationState{}).Where("id = ?", domain.OrganizationStateID)
		if expectedRevision != nil {
			query = query.Where("revision = ?", *expectedRevision)
		}
		result := query.Updates(map[string]any{
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": time.Now().UTC(),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var state domain.OrganizationState
			if err := tx.Select("revision").First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
				return err
			}
			if expectedRevision != nil && state.Revision != *expectedRevision {
				return domain.ErrTreeRevisionConflict
			}
			return fmt.Errorf("organization revision row was not updated")
		}

		var state domain.OrganizationState
		if err := tx.Select("revision").First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
			return err
		}
		nextRevision = state.Revision
		return fn(contextWithTransaction(ctx, tx))
	})
	return nextRevision, err
}

func retryableOrganizationWrite(err error) bool {
	if err == nil || errors.Is(err, domain.ErrTreeRevisionConflict) {
		return false
	}
	if stateErr, ok := errors.AsType[interface {
		error
		SQLState() string
	}](err); ok {
		switch stateErr.SQLState() {
		case "40001", "40P01", "55P03":
			return true
		}
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "database is locked") ||
		strings.Contains(message, "database table is locked") ||
		strings.Contains(message, "sqlite_busy") ||
		strings.Contains(message, "deadlock detected") ||
		strings.Contains(message, "could not serialize access") ||
		strings.Contains(message, "lock not available")
}
