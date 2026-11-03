package requestmeta

import (
	"context"
	"strings"
)

type requestIDKey struct{}

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, strings.Clone(id))
}

type taskKey struct{}
type operatorKey struct{}
type sqlPollKey struct{}

// WithSQLPoll marks only a background polling query. The SQL logger may omit
// successful, fast, empty results; slow queries and errors remain observable.
func WithSQLPoll(ctx context.Context) context.Context {
	return context.WithValue(ctx, sqlPollKey{}, true)
}

func IsSQLPoll(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	marked, _ := ctx.Value(sqlPollKey{}).(bool)
	return marked
}

// WithTask binds owned task metadata to an application lifecycle context.
func WithTask(ctx context.Context, taskID, operatorID string) context.Context {
	ctx = context.WithValue(ctx, taskKey{}, strings.Clone(taskID))
	return context.WithValue(ctx, operatorKey{}, strings.Clone(operatorID))
}

func TaskID(ctx context.Context) string     { return stringValue(ctx, taskKey{}) }
func OperatorID(ctx context.Context) string { return stringValue(ctx, operatorKey{}) }

func stringValue(ctx context.Context, key any) string {
	if ctx == nil {
		return ""
	}
	value, _ := ctx.Value(key).(string)
	return value
}

func RequestID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}
