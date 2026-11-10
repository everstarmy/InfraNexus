package bootstrap

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
	"infranexus/internal/testdb"
)

type legacyUser struct {
	domain.BaseEntity
	Username string `gorm:"size:64;uniqueIndex;not null"`
	Email    string `gorm:"size:128;uniqueIndex;not null"`
	Password string `gorm:"size:255;not null"`
}

func (legacyUser) TableName() string { return "users" }

type legacyRole struct {
	domain.BaseEntity
	Code string `gorm:"size:64;uniqueIndex;not null"`
	Name string `gorm:"size:64;not null"`
}

func (legacyRole) TableName() string { return "roles" }

type legacyLDAPConfig struct {
	domain.BaseEntity
	Name                string                                          `gorm:"size:64;not null"`
	Type                string                                          `gorm:"size:16;not null"`
	Domain              string                                          `gorm:"size:128;not null"`
	ServerHost          string                                          `gorm:"size:255;not null"`
	Port                int                                             `gorm:"not null"`
	UseSSL              bool                                            `gorm:"not null;default:false"`
	StartTLS            bool                                            `gorm:"not null;default:false"`
	InsecureSkipVerify  bool                                            `gorm:"not null;default:false"`
	BindDN              string                                          `gorm:"size:512"`
	BindPassword        string                                          `gorm:"size:1024"`
	BaseDN              string                                          `gorm:"size:512;not null"`
	UserFilter          string                                          `gorm:"size:512;not null"`
	AttributeMapping    datatypes.JSONType[domain.LDAPAttributeMapping] `gorm:"type:jsonb"`
	DepartmentSync      datatypes.JSONType[domain.LDAPDepartmentSync]   `gorm:"type:jsonb"`
	DefaultRoleID       *uuid.UUID                                      `gorm:"type:uuid"`
	Enabled             bool                                            `gorm:"not null;default:false"`
	SyncEnabled         bool                                            `gorm:"not null;default:false"`
	SyncIntervalMinutes int                                             `gorm:"not null"`
	DisableMissingUsers bool                                            `gorm:"not null;default:false"`
	TimeoutSeconds      int                                             `gorm:"not null"`
	SyncStatus          string                                          `gorm:"size:16;not null;default:idle"`
	SyncStartedAt       *time.Time
	LastSyncAt          *time.Time
	LastSuccessAt       *time.Time
}

func (legacyLDAPConfig) TableName() string { return "ldap_configs" }

type legacyLDAPSyncLog struct {
	domain.BaseEntity
	ConfigID   uuid.UUID `gorm:"type:uuid;not null;index"`
	Domain     string    `gorm:"size:128;not null"`
	Trigger    string    `gorm:"size:16;not null"`
	Mode       string    `gorm:"size:16;not null"`
	Status     string    `gorm:"size:16;not null;index"`
	StartedAt  time.Time `gorm:"not null"`
	FinishedAt *time.Time
	DurationMs int64
	Report     datatypes.JSONType[domain.SyncReport] `gorm:"type:jsonb"`
	Message    string                                `gorm:"size:1024"`
	OperatorID *uuid.UUID                            `gorm:"type:uuid"`
	RequestID  string                                `gorm:"size:128;index"`
}

func (legacyLDAPSyncLog) TableName() string { return "ldap_sync_logs" }

type legacyBootstrapUser struct {
	domain.BaseEntity
	Username string `gorm:"size:64;not null;uniqueIndex:idx_users_username"`
	Domain   string `gorm:"size:128;not null;default:''"`
	Email    string `gorm:"size:128;not null;uniqueIndex:idx_users_email"`
	Password string `gorm:"size:255;not null"`
	Nickname string `gorm:"size:64"`
	Status   int    `gorm:"default:1"`
	AuthType string `gorm:"size:16;not null;default:local"`
	BuiltIn  bool   `gorm:"not null;default:false"`
}

func (legacyBootstrapUser) TableName() string { return "users" }

func TestLegacyPostgresAdminKeepsPublicPasswordUntilExplicitRotation(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard, TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	exerciseLegacyAdminUpgrade(t, db)
}

func exerciseLegacyAdminUpgrade(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&legacyBootstrapUser{}, &legacyRole{}); err != nil {
		t.Fatal(err)
	}
	legacyPassword := "admin123456"
	hash, err := bcrypt.GenerateFromPassword([]byte(legacyPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	legacyAdmin := legacyBootstrapUser{
		Username: "admin", Email: "admin@infranexus.com", Password: string(hash),
		Nickname: "系统管理员", Status: domain.StatusEnabled, AuthType: domain.AuthTypeLocal, BuiltIn: true,
	}
	if err := db.Create(&legacyAdmin).Error; err != nil {
		t.Fatal(err)
	}
	var logOutput bytes.Buffer
	log := slog.New(slog.NewTextHandler(&logOutput, nil))
	if err := Migrate(db); err != nil {
		t.Fatalf("upgrade legacy schema: %v", err)
	}
	if err := Seed(db, log); err != nil {
		t.Fatalf("seed upgraded schema: %v", err)
	}
	if err := service.NewSetupService(repository.NewSetupRepository(db)).Initialize(t.Context(), domain.SetupRequest{Password: "Setup!Pass234"}); err == nil {
		t.Fatal("setup must reject an existing legacy administrator")
	}
	var upgraded domain.User
	if err := db.First(&upgraded, "domain = ? AND username = ?", "", "admin").Error; err != nil {
		t.Fatal(err)
	}
	if upgraded.Password != string(hash) || upgraded.AuthVersion < 1 {
		t.Fatal("normal migration/setup must preserve the legacy password and initialize auth version")
	}
	if strings.Contains(logOutput.String(), legacyPassword) || strings.Contains(logOutput.String(), "Setup!Pass234") {
		t.Fatal("administrator credentials were written to logs")
	}
	if err := RotateBootstrapAdminPassword(db, "Rotated!Pass234"); err != nil {
		t.Fatalf("rotate legacy admin: %v", err)
	}
	var rotated domain.User
	if err := db.First(&rotated, "id = ?", upgraded.ID).Error; err != nil {
		t.Fatal(err)
	}
	if rotated.AuthVersion != upgraded.AuthVersion+1 {
		t.Fatalf("rotation did not revoke legacy credentials: auth_version %d -> %d", upgraded.AuthVersion, rotated.AuthVersion)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(rotated.Password), []byte("Rotated!Pass234")); err != nil {
		t.Fatal("rotated password is not usable")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(rotated.Password), []byte(legacyPassword)); err == nil {
		t.Fatal("legacy public password remained valid after explicit rotation")
	}
}

func TestMigrateUpgradesLegacyUniqueIndexesSoDeletedNamesCanBeReused(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard, TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&legacyUser{}, &legacyRole{}); err != nil {
		t.Fatal(err)
	}
	old := legacyUser{Username: "alice", Email: "alice@x.com", Password: "x"}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&old).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyUser{Username: "alice", Email: "alice@x.com", Password: "x"}).Error; err == nil {
		t.Fatal("legacy schema unexpectedly allowed reuse; test precondition broken")
	}
	for range 2 {
		if err := Migrate(db); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}
	for _, name := range []string{"idx_users_username", "idx_users_email", "idx_roles_code"} {
		if db.Migrator().HasIndex(&domain.User{}, name) || db.Migrator().HasIndex(&domain.Role{}, name) {
			t.Fatalf("legacy index %s still present", name)
		}
	}
	if err := db.Create(&domain.User{Username: "alice", Email: "alice@x.com", Password: "x"}).Error; err != nil {
		t.Fatalf("reuse after migrate: %v", err)
	}
	if err := db.Create(&domain.User{Username: "alice", Email: "other@x.com", Password: "x"}).Error; err == nil {
		t.Fatal("active duplicate username accepted after migrate")
	}
}

func TestMigrationLedgerSkipsCompletedBackfill(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("initial migration: %v", err)
	}
	if !db.Migrator().HasColumn(&domain.LDAPSyncLog{}, "RequestID") {
		t.Fatal("LDAP sync request_id migration did not add its column")
	}
	for _, column := range []string{"PlanID", "IdempotencyKey", "Phase", "Processed", "Total"} {
		if !db.Migrator().HasColumn(&domain.LDAPSyncLog{}, column) {
			t.Fatalf("LDAP recoverable task migration did not add %s", column)
		}
	}
	if !db.Migrator().HasColumn(&domain.LDAPConfig{}, "SyncTaskID") || !db.Migrator().HasColumn(&domain.LDAPConfig{}, "SyncLeaseExpiresAt") {
		t.Fatal("LDAP sync owner lease migration did not add fencing columns")
	}
	if !db.Migrator().HasTable(&domain.LDAPSyncPlanSnapshot{}) {
		t.Fatal("LDAP plan snapshot migration did not create its short-lived table")
	}
	if !db.Migrator().HasIndex(&domain.LDAPSyncLog{}, "uidx_ldap_sync_idempotency") {
		t.Fatal("LDAP idempotency migration did not create its scoped unique index")
	}

	user := domain.User{Username: "versioned", Email: "versioned@example.test", Password: "hash", AuthVersion: 7}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&domain.OrganizationState{}).Where("id = ?", "018f2a51-55b2-7f19-9000-000000000001").Update("revision", 9).Error; err != nil {
		t.Fatal(err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}

	var migrationCount int64
	if err := db.Model(&domain.SchemaMigration{}).Where("version = ?", migrationSecurityRevisionState).Count(&migrationCount).Error; err != nil {
		t.Fatal(err)
	}
	if migrationCount != 1 {
		t.Fatalf("migration ledger has %d entries, want 1", migrationCount)
	}
	if err := db.Model(&domain.SchemaMigration{}).Count(&migrationCount).Error; err != nil {
		t.Fatal(err)
	}
	if migrationCount != int64(len(migrations)) {
		t.Fatalf("migration ledger has %d version rows, want %d", migrationCount, len(migrations))
	}
	var migrated domain.User
	if err := db.First(&migrated, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.AuthVersion != 7 {
		t.Fatalf("completed backfill was rerun: auth_version=%d", migrated.AuthVersion)
	}
	var state domain.OrganizationState
	if err := db.First(&state).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != 9 {
		t.Fatalf("completed migration reset organization revision to %d", state.Revision)
	}
}

func TestLDAPTaskMigrationPreservesLegacySyncRows(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	// The prior platform migration already created users. Later migrations
	// may legitimately reference it even though this test exercises LDAP data.
	if err := db.AutoMigrate(&domain.SchemaMigration{}, &legacyBootstrapUser{}, &legacyLDAPConfig{}, &legacyLDAPSyncLog{}); err != nil {
		t.Fatal(err)
	}
	for _, previous := range migrations {
		if previous.version == migrationLDAPRecoverableTasks {
			break
		}
		if err := db.Create(&domain.SchemaMigration{Version: previous.version}).Error; err != nil {
			t.Fatal(err)
		}
	}
	config := legacyLDAPConfig{
		Name: "Legacy directory", Type: domain.DirectoryTypeLDAP, Domain: "legacy.example.test",
		ServerHost: "ldap.example.test", Port: 636, BaseDN: "DC=example,DC=test",
		UserFilter: "(&(objectClass=user)(uid=%s))", SyncIntervalMinutes: 60, TimeoutSeconds: 5,
		SyncStatus: domain.SyncStatusIdle,
	}
	if err := db.Create(&config).Error; err != nil {
		t.Fatal(err)
	}
	legacyID := uuid.New()
	legacyLog := legacyLDAPSyncLog{
		ID: legacyID, ConfigID: config.ID, Domain: config.Domain,
		Trigger: domain.SyncTriggerManual, Mode: domain.SyncModeFull, Status: domain.SyncStatusSuccess,
		StartedAt: time.Now(), RequestID: "legacy-request",
		Report: datatypes.NewJSONType(domain.SyncReport{Errors: []domain.SyncItemError{}}),
	}
	if err := db.Create(&legacyLog).Error; err != nil {
		t.Fatal(err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate stored PostgreSQL LDAP history: %v", err)
	}
	var migrated domain.LDAPSyncLog
	if err := db.First(&migrated, "id = ?", legacyID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.Domain != config.Domain || migrated.RequestID != "legacy-request" || migrated.PlanID != uuid.Nil || migrated.Processed != 0 {
		t.Fatalf("legacy PostgreSQL LDAP task was not preserved: %+v", migrated)
	}
	if !db.Migrator().HasTable(&domain.LDAPSyncPlanSnapshot{}) || !db.Migrator().HasIndex(&domain.LDAPSyncLog{}, "uidx_ldap_sync_idempotency") {
		t.Fatal("PostgreSQL LDAP plan snapshot or idempotency index missing after upgrade")
	}
}

func TestIdentityIsScopedByDomainAndEmptyEmailsCoexist(t *testing.T) {
	container, _, cleanup := setupTestApp(t)
	defer cleanup()
	db := container.DB
	for _, table := range []any{&domain.Department{}, &domain.LDAPConfig{}, &domain.LDAPSyncLog{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table for %T", table)
		}
	}
	local := domain.User{Username: "zhangsan", Email: "", Password: "x"}
	corp := domain.User{Username: "zhangsan", Domain: "corp.local", AuthType: domain.AuthTypeAD, Email: ""}
	other := domain.User{Username: "zhangsan", Domain: "branch.local", AuthType: domain.AuthTypeAD, Email: ""}
	for _, u := range []*domain.User{&local, &corp, &other} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("create %s@%s: %v", u.Username, u.Domain, err)
		}
	}
	if local.AuthType != domain.AuthTypeLocal {
		t.Fatalf("local user auth type defaulted to %q", local.AuthType)
	}
	dup := domain.User{Username: "zhangsan", Domain: "corp.local", AuthType: domain.AuthTypeAD}
	if err := db.Create(&dup).Error; err == nil {
		t.Fatal("duplicate username accepted inside one domain")
	}
	if err := db.Create(&domain.User{Username: "lisi", Email: "dup@x.com"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.User{Username: "wangwu", Email: "dup@x.com"}).Error; err == nil {
		t.Fatal("duplicate non-empty email accepted")
	}
}
