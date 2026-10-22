package repository

import (
	"context"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

const authorizationChangedChannel = "infranexus:authorization:changed"

type authorizationStateRepository struct{ db *gorm.DB }

func NewAuthorizationStateRepository(db *gorm.DB) domain.AuthorizationOutboxRepository {
	return &authorizationStateRepository{db: db}
}

func (r *authorizationStateRepository) Revision(ctx context.Context) (int64, error) {
	var state domain.AuthorizationState
	err := r.db.WithContext(ctx).Select("revision").First(&state, "id = ?", domain.AuthorizationStateID).Error
	return state.Revision, err
}

func (r *authorizationStateRepository) Pending(ctx context.Context, now time.Time, limit int) ([]domain.AuthorizationOutbox, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var rows []domain.AuthorizationOutbox
	err := r.db.WithContext(ctx).
		Where("processed_at IS NULL AND next_attempt_at <= ?", now).
		Order("revision ASC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *authorizationStateRepository) MarkPublished(ctx context.Context, id uuid.UUID, at time.Time) error {
	return r.db.WithContext(ctx).Model(&domain.AuthorizationOutbox{}).
		Where("id = ? AND processed_at IS NULL", id).
		Updates(map[string]any{"processed_at": at, "last_error": ""}).Error
}

func (r *authorizationStateRepository) MarkFailed(ctx context.Context, id uuid.UUID, message string, nextAttempt time.Time) error {
	if len(message) > 512 {
		message = message[:512]
	}
	return r.db.WithContext(ctx).Model(&domain.AuthorizationOutbox{}).
		Where("id = ? AND processed_at IS NULL", id).
		Updates(map[string]any{
			"attempt_count":   gorm.Expr("attempt_count + 1"),
			"last_error":      message,
			"next_attempt_at": nextAttempt,
		}).Error
}

type redisAuthorizationNotifier struct{ client *redis.Client }

func NewRedisAuthorizationNotifier(client *redis.Client) domain.AuthorizationNotifier {
	if client == nil {
		return nil
	}
	return &redisAuthorizationNotifier{client: client}
}

func (n *redisAuthorizationNotifier) Publish(ctx context.Context, revision int64) error {
	return n.client.Publish(ctx, authorizationChangedChannel, strconv.FormatInt(revision, 10)).Err()
}

func (n *redisAuthorizationNotifier) Subscribe(ctx context.Context) (<-chan int64, error) {
	pubsub := n.client.Subscribe(ctx, authorizationChangedChannel)
	// Bound the handshake so a Redis outage cannot stall the outbox worker's
	// polling loop while go-redis retries the subscription connection.
	subscribeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if _, err := pubsub.Receive(subscribeCtx); err != nil {
		_ = pubsub.Close()
		return nil, err
	}
	out := make(chan int64, 32)
	go func() {
		defer close(out)
		defer func() { _ = pubsub.Close() }()
		for message := range pubsub.Channel() {
			revision, err := strconv.ParseInt(message.Payload, 10, 64)
			if err != nil {
				continue
			}
			select {
			case out <- revision:
			case <-ctx.Done():
				return
			default:
				// Revision checks on requests remain authoritative; newest signal wins.
				select {
				case <-out:
				default:
				}
				select {
				case out <- revision:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return out, nil
}
