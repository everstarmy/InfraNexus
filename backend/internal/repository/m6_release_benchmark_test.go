package repository

import (
	"context"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/datatypes"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

func BenchmarkM6PostgresAuthorizationRevisionRead(b *testing.B) {
	db := openM6BenchmarkPostgres(b)
	if err := db.AutoMigrate(&domain.AuthorizationState{}); err != nil {
		b.Fatal(err)
	}
	state := domain.AuthorizationState{ID: domain.AuthorizationStateID, Revision: 1}
	if err := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.Assignments(map[string]any{"revision": 1}),
	}).Create(&state).Error; err != nil {
		b.Fatal(err)
	}

	repository := NewAuthorizationStateRepository(db)
	ctx := context.Background()
	latencies := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		started := time.Now()
		if _, err := repository.Revision(ctx); err != nil {
			b.Fatal(err)
		}
		latencies = append(latencies, time.Since(started))
	}
	b.StopTimer()
	reportM6LatencyPercentiles(b, latencies)
}

func BenchmarkM6PostgresLDAPProgressLeaseWrite(b *testing.B) {
	db := openM6BenchmarkPostgres(b)
	if err := db.AutoMigrate(&domain.LDAPConfig{}, &domain.LDAPSyncLog{}); err != nil {
		b.Fatal(err)
	}

	now := time.Now()
	configID := uuid.New()
	config := domain.LDAPConfig{
		ID:         configID,
		Name:       "M6 progress benchmark",
		Type:       domain.AuthTypeLDAP,
		Domain:     uuid.NewString() + ".example.test",
		ServerHost: "ldap.example.test",
		Port:       636,
		BaseDN:     "DC=example,DC=test",
		UserFilter: "(uid=%s)",
		SyncStatus: domain.SyncStatusIdle,
	}
	if err := db.Create(&config).Error; err != nil {
		b.Fatal(err)
	}

	total := 1_000
	log := &domain.LDAPSyncLog{
		ID:         uuid.New(),
		ConfigID:   configID,
		Domain:     config.Domain,
		Trigger:    domain.SyncTriggerManual,
		Mode:       "full",
		Status:     domain.SyncStatusRunning,
		StartedAt:  now,
		Phase:      domain.SyncPhaseApplying,
		Total:      &total,
	}
	repository := NewLDAPRepository(db)
	acquired, err := repository.CreateSyncTask(b.Context(), configID, config.UpdatedAt, now, now.Add(time.Hour), log)
	if err != nil || !acquired {
		b.Fatalf("prepare leased sync task: acquired=%v error=%v", acquired, err)
	}

	latencies := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	processed := 0
	for b.Loop() {
		log.Processed = processed % total
		log.Report = datatypes.NewJSONType(domain.SyncReport{Total: total, Updated: processed})
		started := time.Now()
		owned, err := repository.SaveLogIfOwner(b.Context(), log, time.Now())
		if err != nil || !owned {
			b.Fatalf("save leased sync progress: owned=%v error=%v", owned, err)
		}
		latencies = append(latencies, time.Since(started))
		processed++
	}
	b.StopTimer()
	reportM6LatencyPercentiles(b, latencies)
}

func BenchmarkM6RedisSSEPublishAndDeliveryRead(b *testing.B) {
	address := os.Getenv("INFRANEXUS_TEST_REDIS_ADDR")
	if address == "" {
		b.Skip("set INFRANEXUS_TEST_REDIS_ADDR to an isolated, disposable Redis server")
	}
	client := redis.NewClient(&redis.Options{Addr: address, DB: 15})
	if err := client.Ping(b.Context()).Err(); err != nil {
		b.Fatalf("connect benchmark Redis: %v", err)
	}
	if err := client.Del(b.Context(), realtimeEventStream).Err(); err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		_ = client.Del(context.Background(), realtimeEventStream).Err()
		_ = client.Close()
	})

	store := NewRedisEventStore(client)
	cursor, err := store.LatestID(b.Context())
	if err != nil {
		b.Fatal(err)
	}
	latencies := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	sequence := 0
	for b.Loop() {
		started := time.Now()
		if err := store.Publish(b.Context(), "ldap.sync.progress", map[string]int{"processed": sequence}); err != nil {
			b.Fatal(err)
		}
		events, snapshot, err := store.Read(b.Context(), cursor, 0, 10)
		if err != nil || snapshot || len(events) != 1 {
			b.Fatalf("read published SSE event: events=%d snapshot=%v error=%v", len(events), snapshot, err)
		}
		cursor = events[0].ID
		latencies = append(latencies, time.Since(started))
		sequence++
	}
	b.StopTimer()
	reportM6LatencyPercentiles(b, latencies)
}

func openM6BenchmarkPostgres(b *testing.B) *gorm.DB {
	b.Helper()
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		b.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		b.Fatalf("connect benchmark PostgreSQL database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func reportM6LatencyPercentiles(b *testing.B, latencies []time.Duration) {
	b.Helper()
	if len(latencies) == 0 {
		return
	}
	slices.Sort(latencies)
	p50 := latencies[(len(latencies)-1)*50/100]
	p95 := latencies[(len(latencies)-1)*95/100]
	b.ReportMetric(float64(p50.Microseconds()), "p50-us")
	b.ReportMetric(float64(p95.Microseconds()), "p95-us")
}
