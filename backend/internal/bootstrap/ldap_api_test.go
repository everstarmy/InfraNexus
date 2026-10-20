package bootstrap

import (
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
	"infranexus/internal/testutil/ldaptest"
)

const (
	dirBindDN = "CN=svc-infranexus,OU=Service,DC=corp,DC=local"
	dirBindPW = "Bind!Secret1"
)

var dirGUID = string([]byte{0xE0, 0x04, 0x25, 0x3F, 0x89, 0x4F, 0xD3, 0x11, 0x9A, 0x0C, 0x03, 0x05, 0xE8, 0x2C, 0x33, 0x01})

func dirUser(dn, sam, display, mail, dept, guid, uac, changed string) ldaptest.Entry {
	return ldaptest.Entry{DN: dn, Password: "Pa55!word", Attrs: map[string][]string{
		"objectClass":        {"top", "person", "organizationalPerson", "user"},
		"sAMAccountName":     {sam},
		"displayName":        {display},
		"mail":               {mail},
		"department":         {dept},
		"objectGUID":         {guid},
		"userAccountControl": {uac},
		"whenChanged":        {changed},
	}}
}

func startDirectory(t *testing.T) *ldaptest.Server {
	t.Helper()
	return ldaptest.Start(t, dirBindDN, dirBindPW,
		dirUser("CN=Zhang San,OU=Platform,OU=RD,DC=corp,DC=local", "zhangsan", "张三", "zhangsan@corp.local", "研发部", dirGUID, "512", "20261001000000.0Z"),
		dirUser("CN=Li Si,OU=RD,DC=corp,DC=local", "lisi", "李四", "lisi@corp.local", "研发部", "guid-lisi", "514", "20261010000000.0Z"),
		dirUser("CN=Wang Wu,OU=Sales,DC=corp,DC=local", "wangwu", "王五", "", "销售部", "guid-wangwu", "512", "20261020000000.0Z"),
	)
}

func directoryRequest(srv *ldaptest.Server, overrides map[string]any) map[string]any {
	body := map[string]any{
		"name":                  "总部 AD",
		"type":                  "ad",
		"domain":                "corp.local",
		"server_host":           srv.Host,
		"port":                  srv.Port,
		"bind_dn":               dirBindDN,
		"bind_password":         dirBindPW,
		"base_dn":               "DC=corp,DC=local",
		"user_filter":           "(&(objectClass=user)(sAMAccountName=%s))",
		"enabled":               true,
		"timeout_seconds":       5,
		"sync_interval_minutes": 60,
	}
	for k, v := range overrides {
		body[k] = v
	}
	return body
}

func createDirectory(t *testing.T, app *fiber.App, bearer string, body map[string]any) domain.LDAPConfig {
	t.Helper()
	r := call(t, app, "POST", "/api/v1/ldap/configs", bearer, body)
	expectCode(t, r, 200, response.CodeSuccess)
	return decode[domain.LDAPConfig](t, r.Data)
}

func TestDirectoryConfigLifecycleEncryptsAndMasksBindPassword(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	srv := startDirectory(t)
	r := call(t, app, "POST", "/api/v1/ldap/configs", bearer, directoryRequest(srv, nil))
	expectCode(t, r, 200, response.CodeSuccess)
	if strings.Contains(string(r.Data), dirBindPW) || strings.Contains(string(r.Data), `"bind_password"`) {
		t.Fatalf("bind password leaked in response: %s", r.Data)
	}
	cfg := decode[domain.LDAPConfig](t, r.Data)
	if !cfg.HasBindPassword || cfg.AttributeMapping.Data().Username != "sAMAccountName" || cfg.DepartmentSync.Data().Strategy != domain.DeptStrategyNone {
		t.Fatalf("defaults not applied: %+v", cfg)
	}
	var stored domain.LDAPConfig
	container.DB.First(&stored, "id = ?", cfg.ID)
	if !strings.HasPrefix(stored.BindPassword, "v1:") || strings.Contains(stored.BindPassword, dirBindPW) {
		t.Fatalf("bind password not encrypted at rest: %q", stored.BindPassword)
	}
	update := directoryRequest(srv, map[string]any{"name": "总部域控", "bind_password": ""})
	expectCode(t, call(t, app, "PUT", "/api/v1/ldap/configs/"+cfg.ID.String(), bearer, update), 200, response.CodeSuccess)
	var after domain.LDAPConfig
	container.DB.First(&after, "id = ?", cfg.ID)
	if after.BindPassword != stored.BindPassword || after.Name != "总部域控" {
		t.Fatalf("empty password on update must keep the stored secret: %+v", after)
	}
	expectCode(t, call(t, app, "POST", "/api/v1/ldap/configs", bearer, directoryRequest(srv, nil)), 409, response.CodeResourceConflict)
	expectCode(t, call(t, app, "POST", "/api/v1/ldap/configs", bearer, directoryRequest(srv, map[string]any{"domain": "local"})), 400, response.CodeParamInvalid)
	expectCode(t, call(t, app, "POST", "/api/v1/ldap/configs", bearer, directoryRequest(srv, map[string]any{"domain": "b.local", "use_ssl": true, "start_tls": true})), 400, response.CodeParamInvalid)
	expectCode(t, call(t, app, "POST", "/api/v1/ldap/configs", bearer, directoryRequest(srv, map[string]any{"domain": "c.local", "user_filter": "(uid=fixed)"})), 400, response.CodeParamInvalid)
	ok := decode[domain.LDAPTestResult](t, call(t, app, "POST", "/api/v1/ldap/test", bearer, directoryRequest(srv, map[string]any{"bind_password": "", "config_id": cfg.ID})).Data)
	if !ok.Success || len(ok.SampleUsers) == 0 {
		t.Fatalf("test with stored password: %+v", ok)
	}
	bad := decode[domain.LDAPTestResult](t, call(t, app, "POST", "/api/v1/ldap/test", bearer, directoryRequest(srv, map[string]any{"bind_password": "nope"})).Data)
	if bad.Success || bad.Stage != "bind" {
		t.Fatalf("test with wrong password: %+v", bad)
	}
	expectCode(t, call(t, app, "DELETE", "/api/v1/ldap/configs/"+cfg.ID.String(), bearer, nil), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "GET", "/api/v1/ldap/configs/"+cfg.ID.String(), bearer, nil), 404, response.CodeDirectoryConfigNotFound)
}

func TestDomainLoginProvisionsUsersJustInTime(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	srv := startDirectory(t)
	hq := createDept(t, app, bearer, "总部", "hq", nil)
	employee := decode[domain.Role](t, call(t, app, "POST", "/api/v1/roles", bearer, map[string]any{"code": "employee", "name": "员工"}).Data)
	createDirectory(t, app, bearer, directoryRequest(srv, map[string]any{
		"default_role_id": employee.ID,
		"department_sync": map[string]any{"strategy": "ou", "root_department_id": hq.ID},
	}))
	domains := decode[[]domain.AuthDomain](t, call(t, app, "GET", "/api/v1/auth/domains", "", nil).Data)
	if len(domains) != 1 || domains[0].Domain != "corp.local" {
		t.Fatalf("login domains: %+v", domains)
	}
	login := map[string]string{"username": "zhangsan", "password": "Pa55!word", "domain": "corp.local"}
	r := call(t, app, "POST", "/api/v1/auth/token", "", login)
	expectCode(t, r, 200, response.CodeSuccess)
	var user domain.User
	if err := container.DB.Preload("Roles").Preload("Department").First(&user, "domain = ? AND username = ?", "corp.local", "zhangsan").Error; err != nil {
		t.Fatalf("JIT user not created: %v", err)
	}
	if user.AuthType != domain.AuthTypeAD || user.Password != "" || user.ExternalID != "3f2504e0-4f89-11d3-9a0c-0305e82c3301" {
		t.Fatalf("JIT identity: %+v", user)
	}
	if len(user.Roles) != 1 || user.Roles[0].ID != employee.ID {
		t.Fatalf("default role not bound: %+v", user.Roles)
	}
	if user.Department == nil || user.Department.Name != "Platform" || !strings.HasPrefix(user.Department.TreePath, hq.TreePath+"/") {
		t.Fatalf("OU department tree not built under root: %+v", user.Department)
	}
	again := call(t, app, "POST", "/api/v1/auth/token", "", login)
	expectCode(t, again, 200, response.CodeSuccess)
	var count int64
	container.DB.Model(&domain.User{}).Where("domain = ?", "corp.local").Count(&count)
	if count != 1 {
		t.Fatalf("repeated login duplicated the profile: %d", count)
	}
	web := doAuth(t, app, "POST", "/api/v1/auth/login", `{"username":"zhangsan","password":"Pa55!word","domain":"corp.local"}`, "http://localhost:5173", "", nil)
	if web.StatusCode != 200 {
		t.Fatalf("web domain login: %d", web.StatusCode)
	}
	readAuth(t, web)
	failures := []struct {
		body   map[string]string
		status int
		code   response.BusinessCode
	}{
		{map[string]string{"username": "zhangsan", "password": "wrong", "domain": "corp.local"}, 401, response.CodeInvalidCredentials},
		{map[string]string{"username": "*", "password": "Pa55!word", "domain": "corp.local"}, 401, response.CodeInvalidCredentials},
		{map[string]string{"username": "lisi", "password": "Pa55!word", "domain": "corp.local"}, 403, response.CodeAccountDisabled},
		{map[string]string{"username": "zhangsan", "password": "Pa55!word", "domain": "unknown.local"}, 400, response.CodeDomainNotFound},
		{map[string]string{"username": "zhangsan", "password": "Pa55!word"}, 401, response.CodeInvalidCredentials},
		{map[string]string{"username": "admin", "password": "admin123456", "domain": "corp.local"}, 401, response.CodeInvalidCredentials},
	}
	for _, f := range failures {
		res := call(t, app, "POST", "/api/v1/auth/token", "", f.body)
		expectCode(t, res, f.status, f.code)
		if f.code == response.CodeInvalidCredentials && f.body["domain"] == "corp.local" && res.Message != "域认证账号或密码错误" {
			t.Fatalf("domain failure message: %q", res.Message)
		}
	}
	expectCode(t, call(t, app, "PATCH", "/api/v1/users/"+user.ID.String()+"/status", bearer, map[string]any{"status": 2}), 200, response.CodeSuccess)
	expectCode(t, call(t, app, "POST", "/api/v1/auth/token", "", login), 403, response.CodeAccountDisabled)
}

func waitForSync(t *testing.T, app *fiber.App, bearer string, configID uuid.UUID, logID uuid.UUID) domain.LDAPSyncLog {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		page := decode[response.PageData[domain.LDAPSyncLog]](t, call(t, app, "GET", "/api/v1/ldap/sync-logs?config_id="+configID.String(), bearer, nil).Data)
		for _, log := range page.Items {
			if log.ID == logID && log.Status != domain.SyncStatusRunning {
				return log
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("sync did not finish in time")
	return domain.LDAPSyncLog{}
}

func TestDirectorySyncPreviewRunAndIncremental(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	srv := startDirectory(t)
	hq := createDept(t, app, bearer, "总部", "hq", nil)
	cfg := createDirectory(t, app, bearer, directoryRequest(srv, map[string]any{
		"disable_missing_users": true,
		"department_sync":       map[string]any{"strategy": "attribute", "root_department_id": hq.ID},
	}))
	ghost := domain.User{Username: "ghost", Domain: "corp.local", AuthType: domain.AuthTypeAD, ExternalID: "guid-ghost", Status: 1}
	container.DB.Create(&ghost)
	plan := decode[domain.SyncPlan](t, call(t, app, "POST", "/api/v1/ldap/preview", bearer, map[string]any{"config_id": cfg.ID, "mode": "full"}).Data)
	if plan.Summary.Create != 2 || plan.Summary.Skip != 1 || plan.Summary.Disable != 1 || len(plan.DepartmentsToCreate) != 2 {
		t.Fatalf("preview: %+v", plan.Summary)
	}
	var beforeRun int64
	container.DB.Model(&domain.User{}).Where("domain = ?", "corp.local").Count(&beforeRun)
	if beforeRun != 1 {
		t.Fatal("preview must not write")
	}
	started := decode[domain.LDAPSyncLog](t, call(t, app, "POST", "/api/v1/ldap/sync", bearer, map[string]any{"config_id": cfg.ID, "mode": "full"}).Data)
	if started.Status != domain.SyncStatusRunning || started.Trigger != domain.SyncTriggerManual {
		t.Fatalf("sync start: %+v", started)
	}
	done := waitForSync(t, app, bearer, cfg.ID, started.ID)
	report := done.Report.Data()
	if done.Status != domain.SyncStatusSuccess || report.Created != 2 || report.Disabled != 1 || report.Skipped != 1 || report.DepartmentsCreated != 2 || report.Failed != 0 {
		t.Fatalf("sync result %s: %+v (%s)", done.Status, report, done.Message)
	}
	var wang domain.User
	container.DB.Preload("Department").First(&wang, "domain = ? AND username = ?", "corp.local", "wangwu")
	if wang.Department == nil || wang.Department.Name != "销售部" || *wang.Department.ParentID != hq.ID || wang.Department.Source != domain.SourceLDAP {
		t.Fatalf("attribute department: %+v", wang.Department)
	}
	container.DB.First(&ghost, "id = ?", ghost.ID)
	if ghost.Status != domain.StatusDisabled {
		t.Fatal("account missing from directory was not disabled")
	}
	srv.SetEntries(dirUser("CN=Zhao Liu,OU=Sales,DC=corp,DC=local", "zhaoliu", "赵六", "zhaoliu@corp.local", "销售部", "guid-zhaoliu", "512", "20991231000000.0Z"))
	incremental := decode[domain.LDAPSyncLog](t, call(t, app, "POST", "/api/v1/ldap/sync", bearer, map[string]any{"config_id": cfg.ID, "mode": "incremental"}).Data)
	finished := waitForSync(t, app, bearer, cfg.ID, incremental.ID)
	if r := finished.Report.Data(); finished.Status != domain.SyncStatusSuccess || r.Created != 1 || r.Disabled != 0 || r.DepartmentsCreated != 0 {
		t.Fatalf("incremental: %s %+v", finished.Status, r)
	}
	var zhang domain.User
	container.DB.First(&zhang, "domain = ? AND username = ?", "corp.local", "zhangsan")
	if zhang.Status != domain.StatusEnabled {
		t.Fatal("incremental sync must not disable accounts absent from the delta")
	}
	dashboard := decode[domain.DashboardOverview](t, call(t, app, "GET", "/api/v1/dashboard/overview", bearer, nil).Data)
	if dashboard.Users.Directory != 4 || len(dashboard.Directories) != 1 || len(dashboard.RecentSyncs) != 2 || dashboard.Permissions.APIs == 0 || dashboard.Departments.FromDirectory != 2 {
		t.Fatalf("dashboard: %+v", dashboard)
	}
}

func TestSyncLockAndSchedulerOnlyStartDueWork(t *testing.T) {
	container, app, cleanup := setupTestApp(t)
	defer cleanup()
	bearer := adminToken(t, app)
	srv := startDirectory(t)
	cfg := createDirectory(t, app, bearer, directoryRequest(srv, map[string]any{"sync_enabled": true, "sync_interval_minutes": 30}))
	repo := repository.NewLDAPRepository(container.DB)
	now := time.Now()
	first, err := repo.TryAcquireSync(t.Context(), cfg.ID, now, now.Add(-time.Hour))
	if err != nil || !first {
		t.Fatalf("first acquire: %v %v", first, err)
	}
	if second, _ := repo.TryAcquireSync(t.Context(), cfg.ID, now, now.Add(-time.Hour)); second {
		t.Fatal("concurrent sync lock acquired twice")
	}
	expectCode(t, call(t, app, "POST", "/api/v1/ldap/sync", bearer, map[string]any{"config_id": cfg.ID}), 409, response.CodeSyncInProgress)
	if stale, _ := repo.TryAcquireSync(t.Context(), cfg.ID, now.Add(3*time.Hour), now.Add(time.Hour)); !stale {
		t.Fatal("stale lock must be reclaimable")
	}
	if err := repo.ReleaseSync(t.Context(), cfg.ID, domain.SyncStatusSuccess, now, &now); err != nil {
		t.Fatal(err)
	}
	svc := service.NewLDAPService(service.LDAPServiceDeps{
		Repo:        repo,
		Users:       repository.NewUserRepository(container.DB),
		Roles:       repository.NewRoleRepository(container.DB),
		Departments: repository.NewDepartmentRepository(container.DB),
		Gateway:     repository.NewLDAPGateway(),
		Cipher:      container.Cipher,
	})
	defer svc.Close()
	if started := svc.RunDueSyncs(t.Context(), now.Add(10*time.Minute)); started != 0 {
		t.Fatalf("config synced 10 minutes ago is not due: %d", started)
	}
	if started := svc.RunDueSyncs(t.Context(), now.Add(31*time.Minute)); started != 1 {
		t.Fatalf("due config not started: %d", started)
	}
	if again := svc.RunDueSyncs(t.Context(), now.Add(32*time.Minute)); again != 0 {
		t.Fatalf("running config must not be started twice: %d", again)
	}
	var logs []domain.LDAPSyncLog
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		logs, _, _ = repo.ListLogs(t.Context(), &cfg.ID, 1, 10)
		if len(logs) == 1 && logs[0].Status != domain.SyncStatusRunning {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(logs) != 1 || logs[0].Trigger != domain.SyncTriggerSchedule || logs[0].Status != domain.SyncStatusSuccess {
		t.Fatalf("scheduled run log: %+v", logs)
	}
}
