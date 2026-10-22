package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"infranexus/internal/domain"
)

const (
	realtimeEventStream = "infranexus:events"
	realtimeStreamLimit = int64(1000)
)

type redisEventStore struct{ client *redis.Client }

func NewRedisEventStore(client *redis.Client) domain.SSEEventStore {
	if client == nil {
		return nil
	}
	return &redisEventStore{client: client}
}

func (s *redisEventStore) Publish(ctx context.Context, event string, data any) error {
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = s.client.XAdd(ctx, &redis.XAddArgs{
		Stream: realtimeEventStream,
		MaxLen: realtimeStreamLimit,
		Approx: true,
		Values: map[string]any{
			"event": event,
			"data":  string(encoded),
			"time":  time.Now().UnixMilli(),
		},
	}).Result()
	return err
}

func (s *redisEventStore) LatestID(ctx context.Context) (string, error) {
	latest, err := s.client.XRevRangeN(ctx, realtimeEventStream, "+", "-", 1).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return "", err
	}
	if len(latest) == 0 {
		return "0-0", nil
	}
	return latest[0].ID, nil
}

func (s *redisEventStore) Read(ctx context.Context, lastID string, block time.Duration, limit int) ([]domain.RealtimeEvent, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	if lastID == "" || lastID == "$" {
		var err error
		lastID, err = s.LatestID(ctx)
		if err != nil {
			return nil, false, err
		}
	}
	if lastID != "0-0" {
		oldest, err := s.client.XRangeN(ctx, realtimeEventStream, "-", "+", 1).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return nil, false, err
		}
		if len(oldest) > 0 && validStreamID(lastID) && compareStreamIDs(lastID, oldest[0].ID) < 0 {
			return s.snapshotRequired(ctx, "retention_gap")
		}
	}
	streams, err := s.client.XRead(ctx, &redis.XReadArgs{
		Streams: []string{realtimeEventStream, lastID},
		Count:   int64(limit + 1),
		Block:   block,
	}).Result()
	if errors.Is(err, redis.Nil) {
		return []domain.RealtimeEvent{}, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if len(streams) == 0 || len(streams[0].Messages) == 0 {
		return []domain.RealtimeEvent{}, false, nil
	}
	messages := streams[0].Messages
	if len(messages) > limit {
		return s.snapshotRequired(ctx, "subscriber_lag")
	}
	events := make([]domain.RealtimeEvent, 0, len(messages))
	for _, message := range messages {
		name, _ := message.Values["event"].(string)
		data, _ := message.Values["data"].(string)
		timestamp := fmt.Sprint(message.Values["time"])
		millis, _ := strconv.ParseInt(timestamp, 10, 64)
		events = append(events, domain.RealtimeEvent{ID: message.ID, Name: name, Data: []byte(data), Time: time.UnixMilli(millis)})
	}
	return events, false, nil
}

func (s *redisEventStore) snapshotRequired(ctx context.Context, reason string) ([]domain.RealtimeEvent, bool, error) {
	latest, err := s.client.XRevRangeN(ctx, realtimeEventStream, "+", "-", 1).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, false, err
	}
	id := "0-0"
	if len(latest) > 0 {
		id = latest[0].ID
	}
	data, err := json.Marshal(map[string]string{"reason": reason})
	if err != nil {
		return nil, false, err
	}
	return []domain.RealtimeEvent{{ID: id, Name: "snapshot.required", Data: data, Time: time.Now()}}, true, nil
}

func validStreamID(id string) bool {
	parts := strings.Split(id, "-")
	if len(parts) != 2 {
		return false
	}
	_, errA := strconv.ParseUint(parts[0], 10, 64)
	_, errB := strconv.ParseUint(parts[1], 10, 64)
	return errA == nil && errB == nil
}

func compareStreamIDs(left, right string) int {
	leftParts, rightParts := strings.Split(left, "-"), strings.Split(right, "-")
	if len(leftParts) != 2 || len(rightParts) != 2 {
		return strings.Compare(left, right)
	}
	for index := range 2 {
		l, errLeft := strconv.ParseUint(leftParts[index], 10, 64)
		r, errRight := strconv.ParseUint(rightParts[index], 10, 64)
		if errLeft != nil || errRight != nil {
			return strings.Compare(left, right)
		}
		if l < r {
			return -1
		}
		if l > r {
			return 1
		}
	}
	return 0
}
