package bootstrap

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"

	"infranexus/internal/config"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"infranexus/internal/repository"
)

// liveADConfig is explicitly opt-in. No directory credentials are embedded in
// test fixtures; LDAP operations in this suite only bind and search.
func liveADConfig(t *testing.T) (*domain.LDAPConfig, string, string) {
	t.Helper()
	endpoint := os.Getenv("INFRANEXUS_LIVE_AD_URL")
	if endpoint == "" {
		t.Skip("set INFRANEXUS_LIVE_AD_URL to opt into an authorized live directory test")
	}
	required := func(name string) string {
		value := os.Getenv(name)
		if value == "" {
			t.Fatalf("live AD test requires %s", name)
		}
		return value
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Scheme != "ldap" && parsed.Scheme != "ldaps") || parsed.User != nil || parsed.Hostname() == "" {
		t.Fatal("live AD URL must specify ldap/ldaps host without credentials")
	}
	port := 389
	if parsed.Scheme == "ldaps" {
		port = 636
	}
	if parsed.Port() != "" {
		port, err = strconv.Atoi(parsed.Port())
		if err != nil {
			t.Fatal("invalid AD port")
		}
	}
	bind := required("INFRANEXUS_LIVE_AD_BIND_USER")
	domainName := required("INFRANEXUS_LIVE_AD_DOMAIN")
	username := os.Getenv("INFRANEXUS_LIVE_AD_LOGIN_USER")
	if username == "" {
		username, _, _ = strings.Cut(bind, "@")
	}
	cfg := &domain.LDAPConfig{
		Type: domain.DirectoryTypeAD, Domain: domainName, ServerHost: parsed.Hostname(), Port: port,
		UseSSL: parsed.Scheme == "ldaps", BindDN: bind, BaseDN: required("INFRANEXUS_LIVE_AD_BASE_DN"),
		UserFilter: "(&(objectCategory=person)(objectClass=user)(sAMAccountName=%s))", TimeoutSeconds: 10,
		AttributeMapping: datatypes.NewJSONType(domain.LDAPAttributeMapping{Username: "sAMAccountName", Email: "mail", Nickname: "displayName", Department: "department", ExternalID: "objectGUID"}),
	}
	if value := os.Getenv("INFRANEXUS_LIVE_AD_START_TLS"); value != "" {
		cfg.StartTLS, err = strconv.ParseBool(value)
		if err != nil || (cfg.StartTLS && cfg.UseSSL) {
			t.Fatal("invalid explicit live AD StartTLS configuration")
		}
	}
	return cfg, required("INFRANEXUS_LIVE_AD_PASSWORD"), username
}

func TestLiveADGatewayReadOnly(t *testing.T) {
	cfg, password, username := liveADConfig(t)
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	gateway := repository.NewLDAPGateway()
	started := time.Now()
	connection, err := gateway.Test(ctx, cfg, password)
	if err != nil || connection == nil || !connection.Success {
		t.Fatalf("AD connection test failed: error=%v", err)
	}
	identity, err := gateway.Authenticate(ctx, cfg, password, username, password)
	if err != nil || identity == nil {
		t.Fatalf("AD authentication failed: %v", err)
	}
	if identity.ExternalID == "" || identity.Disabled || !strings.EqualFold(identity.Username, username) {
		t.Fatal("AD identity mapping is incomplete or inconsistent")
	}
	users, err := gateway.SearchUsers(ctx, cfg, password, nil)
	if err != nil {
		t.Fatalf("AD paged directory search failed: %v", err)
	}
	enabled, disabled, matches := 0, 0, 0
	seen := make(map[string]bool, len(users))
	for _, user := range users {
		if user.Username == "" || user.ExternalID == "" || seen[user.ExternalID] {
			t.Fatal("directory returned empty or duplicate stable identities")
		}
		seen[user.ExternalID] = true
		if user.Disabled {
			disabled++
		} else {
			enabled++
		}
		if user.ExternalID == identity.ExternalID {
			matches++
		}
	}
	if matches != 1 {
		t.Fatalf("authenticated identity appeared %d times in Base DN results", matches)
	}
	t.Logf("live AD read-only passed: total=%d enabled=%d disabled=%d elapsed_ms=%d", len(users), enabled, disabled, time.Since(started).Milliseconds())
}

// Keep a checked, isolated Redis address requirement available to the application
// integration below; the directory itself is never a write target.
func liveRedisAddress(t *testing.T) (string, int) {
	t.Helper()
	host, port, err := net.SplitHostPort(os.Getenv("INFRANEXUS_LIVE_AD_REDIS_ADDR"))
	if err != nil {
		t.Fatal("live application test requires a disposable INFRANEXUS_LIVE_AD_REDIS_ADDR")
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		t.Fatal("live application test Redis must be an isolated loopback service")
	}
	value, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal("invalid test Redis port")
	}
	return host, value
}

type liveLogBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *liveLogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}
func (b *liveLogBuffer) contains(value string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.Contains(b.buffer.String(), value)
}

func liveADApplication(t *testing.T) (*AppContainer, string, *liveLogBuffer) {
	t.Helper()
	host, port := liveRedisAddress(t)
	logs := &liveLogBuffer{}
	cfg := &config.Config{
		App:      config.AppConfig{Name: "InfraNexus-Live-AD-Acceptance", Env: "test"},
		Database: config.DatabaseConfig{Driver: "sqlite", SQLite: config.SQLiteConfig{DBPath: filepath.Join(t.TempDir(), "live-ad.db")}, Pool: config.PoolConfig{MaxIdleConns: 2, MaxOpenConns: 5}},
		Redis:    config.RedisConfig{Host: host, Port: port, PoolSize: 10},
		Session:  config.SessionConfig{CookieName: "infranexus_live_ad", MaxAge: 1800, AbsoluteMaxAge: 86400, SameSite: "Lax"},
		JWT:      config.JWTConfig{Secret: uuid.NewString() + uuid.NewString(), AccessTokenExpire: 900, RefreshTokenExpire: 3600, Issuer: "live-ad-test"},
		Security: config.SecurityConfig{TrustedOrigins: []string{"http://localhost:5173"}, LoginRateLimit: 100, EncryptionKey: uuid.NewString() + uuid.NewString()},
		Storage:  config.StorageConfig{Driver: "memory"},
	}
	if address := os.Getenv("INFRANEXUS_LIVE_AD_POSTGRES_ADDR"); address != "" {
		pgHost, pgPort, err := net.SplitHostPort(address)
		ip := net.ParseIP(pgHost)
		if err != nil || (pgHost != "localhost" && (ip == nil || !ip.IsLoopback())) {
			t.Fatal("live AD PostgreSQL must be a disposable loopback service")
		}
		portNumber, err := strconv.Atoi(pgPort)
		if err != nil {
			t.Fatal("invalid live AD PostgreSQL port")
		}
		pgPassword := os.Getenv("INFRANEXUS_LIVE_AD_POSTGRES_PASSWORD")
		if pgPassword == "" {
			t.Fatal("missing disposable PostgreSQL password")
		}
		cfg.Database = config.DatabaseConfig{Driver: "postgres", Postgres: config.PostgresConfig{Host: pgHost, Port: portNumber, User: "live_ad", Password: pgPassword, DBName: "live_ad", SSLMode: "disable"}, Pool: cfg.Database.Pool}
	}
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	container, err := NewAppContainer(cfg, logger)
	if err != nil {
		t.Fatal("initialize isolated application failed")
	}
	t.Cleanup(container.Close)
	if container.Redis == nil {
		t.Fatal("live acceptance requires real isolated Redis; offline fallback is not acceptable")
	}
	if err := Migrate(container.DB); err != nil {
		t.Fatal(err)
	}
	if err := Seed(container.DB, logger); err != nil {
		t.Fatal(err)
	}
	if err := BootstrapAdmin(container.DB, testAdminPassword, logger); err != nil {
		t.Fatal(err)
	}
	app, err := NewFiberApp(container)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	container.StartBackground()
	go func() { _ = app.Listener(listener) }()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := app.ShutdownWithContext(ctx); err != nil {
			t.Error("isolated application shutdown exceeded its budget")
		}
	})
	return container, "http://" + listener.Addr().String(), logs
}

func liveRequest(ctx context.Context, client *http.Client, base, method, path, bearer string, body any) (apiResult, error) {
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			return apiResult{}, err
		}
	}
	request, err := http.NewRequestWithContext(ctx, method, base+path, bytes.NewReader(payload))
	if err != nil {
		return apiResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		request.Header.Set("Authorization", bearer)
	}
	result, err := client.Do(request)
	if err != nil {
		return apiResult{}, fmt.Errorf("%s %s transport failed", method, path)
	}
	defer result.Body.Close()
	var envelope response.Envelope[jsontext.Value]
	if err := json.UnmarshalRead(io.LimitReader(result.Body, 16<<20), &envelope); err != nil {
		return apiResult{}, fmt.Errorf("%s %s envelope decode failed", method, path)
	}
	return apiResult{Status: result.StatusCode, Code: envelope.Code, Message: envelope.Message, Data: []byte(envelope.Data)}, nil
}

type liveStreamEvent struct{ id, name string }

func openLiveStream(t *testing.T, ctx context.Context, base, bearer, cursor string) (*http.Response, <-chan liveStreamEvent) {
	t.Helper()
	endpoint := base + "/api/v1/sse/notifications"
	if cursor != "" {
		endpoint += "?lastEventId=" + url.QueryEscape(cursor)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", bearer)
	res, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		t.Fatal("SSE connection failed")
	}
	if res.StatusCode != 200 {
		res.Body.Close()
		t.Fatalf("SSE status=%d", res.StatusCode)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	events := make(chan liveStreamEvent, 16)
	go func() {
		defer close(events)
		scanner := bufio.NewScanner(res.Body)
		scanner.Buffer(make([]byte, 4096), 2<<20)
		current := liveStreamEvent{}
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "id: ") {
				current.id = strings.TrimPrefix(line, "id: ")
			}
			if strings.HasPrefix(line, "event: ") {
				current.name = strings.TrimPrefix(line, "event: ")
			}
			if line == "" {
				switch current.name {
				case "connected", "ldap.sync.started", "ldap.sync.finished", "snapshot.required":
					select {
					case events <- current:
					case <-ctx.Done():
						return
					}
				}
				current = liveStreamEvent{}
			}
		}
	}()
	return res, events
}
func awaitLiveEvent(t *testing.T, ctx context.Context, events <-chan liveStreamEvent, name string) liveStreamEvent {
	t.Helper()
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case event, open := <-events:
			if !open {
				t.Fatalf("SSE closed before %s", name)
			}
			if event.name == name {
				return event
			}
		case <-deadline.C:
			t.Fatalf("SSE did not deliver %s", name)
		case <-ctx.Done():
			t.Fatalf("live test cancelled awaiting %s", name)
		}
	}
}

func TestLiveADIsolatedApplicationLifecycle(t *testing.T) {
	cfg, password, username := liveADConfig(t)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	directory, err := repository.NewLDAPGateway().SearchUsers(ctx, cfg, password, nil)
	if err != nil {
		t.Fatal("live directory preflight search failed")
	}
	if len(directory) > 2000 {
		t.Fatal("live application fixture cap is 2000 users; use a narrower test Base DN")
	}
	enabled := 0
	for _, user := range directory {
		if !user.Disabled {
			enabled++
		}
	}
	container, base, logs := liveADApplication(t)
	client := &http.Client{Timeout: 30 * time.Second}
	defer client.CloseIdleConnections()
	request := func(method, path, bearer string, body any) apiResult {
		t.Helper()
		result, err := liveRequest(ctx, client, base, method, path, bearer, body)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	token := func(result apiResult) string {
		t.Helper()
		expectCode(t, result, 200, response.CodeSuccess)
		var pair struct {
			AccessToken string `json:"access_token"`
		}
		if err := json.Unmarshal(result.Data, &pair); err != nil || pair.AccessToken == "" {
			t.Fatal("token response missing access token")
		}
		return "Bearer " + pair.AccessToken
	}
	admin := token(request("POST", "/api/v1/auth/token", "", map[string]string{"username": "admin", "password": testAdminPassword}))
	createdRole := request("POST", "/api/v1/roles", admin, map[string]string{"code": "live-ad-observer", "name": "Live AD acceptance"})
	expectCode(t, createdRole, 200, response.CodeSuccess)
	role := decode[domain.Role](t, createdRole.Data)
	var permission domain.Permission
	if err := container.DB.Where("path = ? AND method = ? AND type = ?", "/api/v1/users", "GET", domain.PermTypeAPI).First(&permission).Error; err != nil {
		t.Fatal("users API permission was not seeded")
	}
	permissionsPath := "/api/v1/roles/" + role.ID.String() + "/permissions"
	expectCode(t, request("POST", permissionsPath, admin, map[string]any{"permission_ids": []uuid.UUID{permission.ID}, "expected_revision": role.EditRevision}), 200, response.CodeSuccess)
	configResult := request("POST", "/api/v1/ldap/configs", admin, domain.LDAPConfigRequest{
		Name: "Live AD acceptance", Type: cfg.Type, Domain: cfg.Domain, ServerHost: cfg.ServerHost, Port: cfg.Port, UseSSL: cfg.UseSSL, StartTLS: cfg.StartTLS,
		BindDN: cfg.BindDN, BindPassword: password, BaseDN: cfg.BaseDN, UserFilter: cfg.UserFilter, AttributeMapping: cfg.AttributeMapping.Data(),
		Enabled: true, DisableMissingUsers: true, TimeoutSeconds: 10, DefaultRoleID: &role.ID,
	})
	expectCode(t, configResult, 200, response.CodeSuccess)
	if bytes.Contains(configResult.Data, []byte(password)) || bytes.Contains(configResult.Data, []byte(`"bind_password"`)) {
		t.Fatal("LDAP config response exposed a secret")
	}
	storedConfig := decode[domain.LDAPConfig](t, configResult.Data)
	var encrypted domain.LDAPConfig
	if err := container.DB.First(&encrypted, "id = ?", storedConfig.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(encrypted.BindPassword, "v1:") || strings.Contains(encrypted.BindPassword, password) {
		t.Fatal("LDAP secret was not encrypted in isolated DB")
	}
	checked := request("POST", "/api/v1/ldap/test", admin, map[string]any{"config_id": storedConfig.ID, "name": "Live AD acceptance", "type": cfg.Type, "domain": cfg.Domain, "server_host": cfg.ServerHost, "port": cfg.Port, "use_ssl": cfg.UseSSL, "start_tls": cfg.StartTLS, "bind_dn": cfg.BindDN, "base_dn": cfg.BaseDN, "user_filter": cfg.UserFilter, "timeout_seconds": 10})
	expectCode(t, checked, 200, response.CodeSuccess)
	if !decode[domain.LDAPTestResult](t, checked.Data).Success {
		t.Fatal("stored-credential AD connection test failed")
	}
	// All authentication attempts use the supplied valid password. No lockout-
	// provoking invalid-password probes or directory writes are performed.
	const concurrentLogins = 3
	results := make(chan apiResult, concurrentLogins)
	failures := make(chan error, concurrentLogins)
	start := make(chan struct{})
	var group sync.WaitGroup
	for range concurrentLogins {
		group.Go(func() {
			<-start
			r, err := liveRequest(ctx, client, base, "POST", "/api/v1/auth/token", "", map[string]string{"username": username, "domain": cfg.Domain, "password": password})
			results <- r
			failures <- err
		})
	}
	close(start)
	group.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	tokens := make([]string, 0, concurrentLogins)
	for result := range results {
		tokens = append(tokens, token(result))
	}
	var jitUsers []domain.User
	if err := container.DB.Preload("Roles").Where("domain = ?", cfg.Domain).Find(&jitUsers).Error; err != nil {
		t.Fatal(err)
	}
	if len(jitUsers) != 1 || len(jitUsers[0].Roles) != 1 || jitUsers[0].Roles[0].ID != role.ID || jitUsers[0].AuthType != domain.AuthTypeAD || jitUsers[0].ExternalID == "" {
		t.Fatal("concurrent live JIT did not converge to one complete AD identity")
	}
	for _, bearer := range tokens {
		expectCode(t, request("GET", "/api/v1/users", bearer, nil), 200, response.CodeSuccess)
	}
	expectCode(t, request("POST", permissionsPath, admin, map[string]any{"permission_ids": []uuid.UUID{}, "expected_revision": role.EditRevision + 1}), 200, response.CodeSuccess)
	for _, bearer := range tokens {
		result := request("GET", "/api/v1/users", bearer, nil)
		if result.Status != 403 {
			t.Fatalf("revoked AD token still has users access: status=%d", result.Status)
		}
	}
	// A synthetic missing user exists only in this disposable application DB.
	ghost := domain.User{Username: "live-audit-missing", Domain: cfg.Domain, AuthType: domain.AuthTypeAD, ExternalID: uuid.NewString(), Status: domain.StatusEnabled}
	if err := container.DB.Create(&ghost).Error; err != nil {
		t.Fatal(err)
	}
	stream, events := openLiveStream(t, ctx, base, admin, "")
	checkpoint := awaitLiveEvent(t, ctx, events, "connected")
	if checkpoint.id == "" {
		t.Fatal("SSE did not return its initial checkpoint")
	}
	preview := request("POST", "/api/v1/ldap/preview", admin, map[string]any{"config_id": storedConfig.ID, "mode": domain.SyncModeFull})
	expectCode(t, preview, 200, response.CodeSuccess)
	plan := decode[domain.SyncPlan](t, preview.Data)
	if plan.Summary.Create != enabled-1 || plan.Summary.Disable != 1 || plan.Summary.Conflict != 0 {
		t.Fatalf("unexpected full plan: create=%d disable=%d conflict=%d", plan.Summary.Create, plan.Summary.Disable, plan.Summary.Conflict)
	}
	var before int64
	if err := container.DB.Model(&domain.User{}).Where("domain = ?", cfg.Domain).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before != 2 {
		t.Fatalf("preview mutated users: rows=%d", before)
	}
	body := syncRequest(plan, uuid.NewString())
	startedResult := request("POST", "/api/v1/ldap/sync", admin, body)
	expectCode(t, startedResult, 200, response.CodeSuccess)
	started := decode[domain.LDAPSyncLog](t, startedResult.Data)
	duplicate := request("POST", "/api/v1/ldap/sync", admin, body)
	expectCode(t, duplicate, 200, response.CodeSuccess)
	if decode[domain.LDAPSyncLog](t, duplicate.Data).ID != started.ID {
		t.Fatal("idempotency key duplicated live sync task")
	}
	awaitLiveEvent(t, ctx, events, "ldap.sync.started")
	finishedEvent := awaitLiveEvent(t, ctx, events, "ldap.sync.finished")
	var done domain.LDAPSyncLog
	if err := container.DB.First(&done, "id = ?", started.ID).Error; err != nil {
		t.Fatal(err)
	}
	report := done.Report.Data()
	if done.Status != domain.SyncStatusSuccess || report.Created != enabled-1 || report.Disabled != 1 || report.Failed != 0 {
		t.Fatalf("live sync result status=%s created=%d disabled=%d failed=%d", done.Status, report.Created, report.Disabled, report.Failed)
	}
	if err := container.DB.First(&ghost, "id = ?", ghost.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ghost.Status != domain.StatusDisabled || ghost.AuthVersion < 2 {
		t.Fatal("missing-user disable failed to revoke local credentials")
	}
	_ = stream.Body.Close()
	replay, replayed := openLiveStream(t, ctx, base, admin, checkpoint.id)
	defer replay.Body.Close()
	if got := awaitLiveEvent(t, ctx, replayed, "connected"); got.id != checkpoint.id {
		t.Fatal("SSE reconnect replaced requested checkpoint")
	}
	if got := awaitLiveEvent(t, ctx, replayed, "ldap.sync.finished"); got.id != finishedEvent.id {
		t.Fatal("SSE replay did not return the committed finish event")
	}
	again := request("POST", "/api/v1/ldap/preview", admin, map[string]any{"config_id": storedConfig.ID, "mode": domain.SyncModeFull})
	expectCode(t, again, 200, response.CodeSuccess)
	againPlan := decode[domain.SyncPlan](t, again.Data)
	if againPlan.Summary.Create != 0 || againPlan.Summary.Update != 0 || againPlan.Summary.Disable != 0 {
		t.Fatalf("second full preview is not idempotent: create=%d update=%d disable=%d", againPlan.Summary.Create, againPlan.Summary.Update, againPlan.Summary.Disable)
	}
	incremental := request("POST", "/api/v1/ldap/preview", admin, map[string]any{"config_id": storedConfig.ID, "mode": domain.SyncModeIncremental})
	expectCode(t, incremental, 200, response.CodeSuccess)
	incrementalPlan := decode[domain.SyncPlan](t, incremental.Data)
	if incrementalPlan.Summary.Disable != 0 || incrementalPlan.Summary.Create != 0 {
		t.Fatal("incremental preview proposed unexpected creates or missing-user disables")
	}
	auditLiveADSnapshot(t, ctx, container, storedConfig, started.ID)
	if logs.contains(password) || logs.contains(strings.TrimPrefix(admin, "Bearer ")) {
		t.Fatal("application logs contain a credential")
	}
	for _, bearer := range tokens {
		if logs.contains(strings.TrimPrefix(bearer, "Bearer ")) {
			t.Fatal("application logs contain an AD access token")
		}
	}
	t.Logf("live AD isolated HTTP chain passed: db=%s concurrent_jit=%d unique_profiles=1 directory_total=%d enabled=%d sync_created=%d sync_disabled=%d sse_replay=verified authz_revocation=verified logs=redacted", container.DB.Dialector.Name(), concurrentLogins, len(directory), enabled, report.Created, report.Disabled)
}
