package service

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"sync"
	"testing"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
	"infranexus/internal/repository"
)

type jitLookupBarrier struct {
	mu    sync.Mutex
	count int
	ready chan struct{}
}

func (b *jitLookupBarrier) wait() {
	b.mu.Lock()
	b.count++
	if b.count == 2 {
		close(b.ready)
	}
	ready := b.ready
	b.mu.Unlock()
	<-ready
}

type synchronizedJITUsers struct {
	domain.UserRepository
	barrier *jitLookupBarrier
}

func (r synchronizedJITUsers) GetByUsername(ctx context.Context, authDomain, username string) (*domain.User, error) {
	user, err := r.UserRepository.GetByUsername(ctx, authDomain, username)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		r.barrier.wait()
	}
	return user, err
}

func syncConfig(strategy string, mappings ...domain.OUMapping) *domain.LDAPConfig {
	return &domain.LDAPConfig{
		Type:                domain.DirectoryTypeAD,
		Domain:              "corp.local",
		BaseDN:              "DC=corp,DC=local",
		DisableMissingUsers: true,
		DepartmentSync:      datatypes.NewJSONType(domain.LDAPDepartmentSync{Strategy: strategy, OUMappings: mappings}),
	}
}

func TestLDAPApplyCreatesUserRoleAndDepartmentAtomically(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "ldap-apply-atomic.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.User{}, &domain.OrganizationState{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.OrganizationState{ID: domain.OrganizationStateID, Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	users := repository.NewUserRepository(db)
	departments := repository.NewDepartmentRepository(db)
	organization := repository.NewOrganizationUnitOfWork(db)
	missingRoleID := uuid.New()
	cfg := &domain.LDAPConfig{Domain: "corp.test", Type: domain.AuthTypeLDAP, DefaultRoleID: &missingRoleID}
	p := plannedUser{
		item:   domain.SyncPlanItem{Action: domain.SyncActionCreate, Username: "ldap-atomic"},
		dir:    domain.DirectoryUser{Username: "ldap-atomic", ExternalID: "external-atomic", Nickname: "LDAP Atomic"},
		values: map[string]any{"email": "ldap-atomic@example.test"},
		target: &deptTarget{Segments: []deptSegment{{Name: "工程部", ExternalID: "ou=engineering"}}},
	}
	resolver := newDepartmentResolver(departments)
	svc := &ldapService{LDAPServiceDeps: LDAPServiceDeps{Users: users, Departments: departments, Organization: organization}}
	if _, err := svc.apply(t.Context(), cfg, resolver, p); err == nil {
		t.Fatal("LDAP create succeeded even though its default role was missing")
	}
	assertCount := func(model any, want int64) {
		t.Helper()
		var count int64
		if err := db.Model(model).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("%T row count = %d, want %d", model, count, want)
		}
	}
	assertCount(&domain.User{}, 0)
	assertCount(&domain.Department{}, 0)
	if resolver.created != 0 {
		t.Fatalf("failed transaction published %d created departments", resolver.created)
	}
	var state domain.OrganizationState
	if err := db.First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != 1 {
		t.Fatalf("failed LDAP transaction advanced organization revision to %d", state.Revision)
	}
	withoutDepartment := p
	withoutDepartment.item = domain.SyncPlanItem{Action: domain.SyncActionCreate, Username: "ldap-no-department"}
	withoutDepartment.dir = domain.DirectoryUser{Username: "ldap-no-department", ExternalID: "external-no-department"}
	withoutDepartment.values = map[string]any{"email": "ldap-no-department@example.test"}
	withoutDepartment.target = nil
	if _, err := svc.apply(t.Context(), cfg, resolver, withoutDepartment); err == nil {
		t.Fatal("LDAP create without a department succeeded despite its default role being missing")
	}
	assertCount(&domain.User{}, 0)
	assertCount(&domain.Department{}, 0)
	if err := db.First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != 1 {
		t.Fatalf("LDAP create without a department advanced organization revision to %d", state.Revision)
	}

	role := domain.Role{Code: "ldap-atomic-role", Name: "LDAP atomic role", Status: domain.StatusEnabled}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	cfg.DefaultRoleID = &role.ID
	created, err := svc.apply(t.Context(), cfg, resolver, p)
	if err != nil {
		t.Fatalf("retry LDAP create after role repair: %v", err)
	}
	if created == nil || len(created.Roles) != 1 || created.Roles[0].ID != role.ID || created.DepartmentID == nil {
		t.Fatalf("created LDAP user is missing its role or department: %+v", created)
	}
	assertCount(&domain.User{}, 1)
	assertCount(&domain.Department{}, 1)
	if resolver.created != 1 {
		t.Fatalf("committed department count = %d, want 1", resolver.created)
	}
	if err := db.First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != 2 {
		t.Fatalf("successful LDAP transaction advanced organization revision to %d, want 2", state.Revision)
	}
}

func TestLDAPProvisionConcurrentJITUsesCommittedIdentityAndRejectsNameBinding(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+filepath.Join(t.TempDir(), "ldap-jit-race.db")+"?_busy_timeout=5000"), &gorm.Config{Logger: logger.Discard, TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	baseUsers := repository.NewUserRepository(db)
	users := synchronizedJITUsers{
		UserRepository: baseUsers,
		barrier:        &jitLookupBarrier{ready: make(chan struct{})},
	}
	service := &ldapService{LDAPServiceDeps: LDAPServiceDeps{
		Users: users, Departments: repository.NewDepartmentRepository(db),
	}}
	cfg := &domain.LDAPConfig{Domain: "corp.test", Type: domain.AuthTypeLDAP}
	directoryUser := domain.DirectoryUser{
		Username: "jit-race", Email: "jit-race@corp.test", Nickname: "JIT race", ExternalID: "stable-jit-guid",
	}
	start := make(chan struct{})
	results := make(chan *domain.User, 2)
	errs := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			user, err := service.provision(t.Context(), cfg, directoryUser)
			results <- user
			errs <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	close(errs)
	var winner *domain.User
	for user := range results {
		if user == nil {
			t.Fatal("concurrent JIT request did not resolve a user")
		}
		if winner == nil {
			winner = user
		} else if user.ID != winner.ID {
			t.Fatalf("concurrent JIT requests returned different users: %s and %s", winner.ID, user.ID)
		}
	}
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent JIT provisioning failed: %v", err)
		}
	}
	var count int64
	if err := db.Model(&domain.User{}).Where("domain = ? AND external_id = ?", cfg.Domain, directoryUser.ExternalID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("concurrent JIT created %d identity rows, want exactly one", count)
	}

	local := &domain.User{Username: "name-collision", Domain: cfg.Domain, Email: "local@corp.test", Password: "hash", AuthType: domain.AuthTypeLocal, Status: domain.StatusEnabled}
	if err := baseUsers.Create(t.Context(), local); err != nil {
		t.Fatal(err)
	}
	_, err = service.provision(t.Context(), cfg, domain.DirectoryUser{Username: local.Username, Email: "directory@corp.test", ExternalID: "different-guid"})
	if err == nil || coreerrors.Classify(err).BizCode != coreerrors.ErrExternalAccountManaged.BizCode {
		t.Fatalf("same-name local identity error = %v, want managed-account conflict", err)
	}
	stored, err := baseUsers.GetByID(t.Context(), local.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.AuthType != domain.AuthTypeLocal || stored.ExternalID != "" {
		t.Fatalf("name-only match altered local account identity: auth_type=%q external_id=%q", stored.AuthType, stored.ExternalID)
	}
}

func TestDepartmentResolverEvictsDeletedCachedDepartment(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "ldap-department-cache.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&domain.Department{}); err != nil {
		t.Fatal(err)
	}
	departmentsRepo := repository.NewDepartmentRepository(db)
	department := domain.Department{
		Name: "Cached department", Code: "cached-department", Source: domain.SourceLDAP,
		ExternalID: "ou=cached", Status: domain.StatusEnabled,
	}
	department.ID = uuid.New()
	department.TreePath = domain.DepartmentPath(domain.DepartmentRootPath, department.ID)
	if err := departmentsRepo.Create(t.Context(), &department); err != nil {
		t.Fatal(err)
	}
	resolver := newDepartmentResolver(departmentsRepo)
	segment := deptSegment{Name: department.Name, ExternalID: department.ExternalID}
	id, err := resolver.find(t.Context(), nil, segment)
	if err != nil || id == nil || *id != department.ID {
		t.Fatalf("initial resolver lookup = %v, %v", id, err)
	}
	if err := db.Delete(&domain.Department{}, "id = ?", department.ID).Error; err != nil {
		t.Fatal(err)
	}
	id, err = resolver.find(t.Context(), nil, segment)
	if err != nil {
		t.Fatal(err)
	}
	if id != nil {
		t.Fatalf("deleted department cache entry resolved to stale ID %s", *id)
	}
	if _, ok := resolver.cache[segment.ExternalID]; ok {
		t.Fatal("deleted department ID remained in the resolver cache")
	}
}

func TestOUChainIsTopDownAndScopedToBaseDN(t *testing.T) {
	chain := ouChain("CN=Zhang San,OU=Platform,OU=RD,CN=Builtin,DC=corp,DC=local", "dc=corp,dc=local")
	if len(chain) != 2 || chain[0].Name != "RD" || chain[1].Name != "Platform" {
		t.Fatalf("chain: %+v", chain)
	}
	if chain[1].DN != "ou=platform,ou=rd,cn=builtin,dc=corp,dc=local" {
		t.Fatalf("normalized level dn: %s", chain[1].DN)
	}
	if got := ouChain("CN=Outsider,OU=X,DC=other,DC=com", "DC=corp,DC=local"); len(got) != 0 {
		t.Fatalf("entries outside base must not map to departments: %+v", got)
	}
}

func TestDepartmentTargetUsesDeepestExplicitMapping(t *testing.T) {
	mapped := uuid.New()
	cfg := syncConfig(domain.DeptStrategyOU, domain.OUMapping{OUDN: "OU=RD, DC=corp, DC=local", DepartmentID: mapped})
	target := departmentTarget(cfg, domain.DirectoryUser{DN: "CN=Zhang San,OU=Platform,OU=RD,DC=corp,DC=local"})
	if target == nil || target.BaseID == nil || *target.BaseID != mapped || len(target.Segments) != 1 || target.Segments[0].Name != "Platform" {
		t.Fatalf("mapped target: %+v", target)
	}
	attr := departmentTarget(syncConfig(domain.DeptStrategyAttribute), domain.DirectoryUser{Department: "研发部"})
	if attr == nil || len(attr.Segments) != 1 || attr.Segments[0].ExternalID != "attr:corp.local:研发部" {
		t.Fatalf("attribute target: %+v", attr)
	}
	if departmentTarget(syncConfig(domain.DeptStrategyNone), domain.DirectoryUser{Department: "研发部"}) != nil {
		t.Fatal("strategy none must not touch departments")
	}
}

type fakeDepartments map[string]uuid.UUID

func (f fakeDepartments) lookup(_ context.Context, t *deptTarget) (*uuid.UUID, string, []string, error) {
	if t == nil || len(t.Segments) == 0 {
		return t.baseOrNil(), "", nil, nil
	}
	last := t.Segments[len(t.Segments)-1]
	if id, ok := f[last.ExternalID]; ok {
		return &id, last.Name, nil, nil
	}
	return nil, last.Name, []string{last.Name}, nil
}

func TestBuildSyncPlanClassifiesEveryDirectoryEntry(t *testing.T) {
	platform := uuid.New()
	cfg := syncConfig(domain.DeptStrategyOU)
	existingID, staleID, renamedID := uuid.New(), uuid.New(), uuid.New()
	locals := []domain.User{
		{BaseEntity: domain.BaseEntity{ID: existingID}, Username: "zhangsan", Nickname: "张三", Email: "zs@corp.local", ExternalID: "g-zs", Status: 1, DepartmentID: &platform},
		{BaseEntity: domain.BaseEntity{ID: staleID}, Username: "gone", ExternalID: "g-gone", Status: 1},
		{BaseEntity: domain.BaseEntity{ID: renamedID}, Username: "oldname", ExternalID: "g-ren", Status: 1},
	}
	dir := []domain.DirectoryUser{
		{DN: "CN=ZS,OU=Platform,OU=RD,DC=corp,DC=local", Username: "ZhangSan", Nickname: "张三", Email: "zs@corp.local", ExternalID: "g-zs"},
		{DN: "CN=New,OU=Sales,DC=corp,DC=local", Username: "newbie", Nickname: "新人", Email: "taken@corp.local", ExternalID: "g-new"},
		{DN: "CN=Ren,OU=Platform,OU=RD,DC=corp,DC=local", Username: "renamed", Nickname: "改名", ExternalID: "g-ren"},
		{DN: "CN=Dis,OU=RD,DC=corp,DC=local", Username: "disabled", ExternalID: "g-dis", Disabled: true},
		{DN: "CN=Dup,OU=RD,DC=corp,DC=local", Username: "newbie", ExternalID: "g-dup"},
		{DN: "CN=NoName,OU=RD,DC=corp,DC=local", ExternalID: "g-none"},
	}
	planned, summary, toCreate, err := buildSyncPlan(t.Context(), syncInputs{
		cfg:         cfg,
		mode:        domain.SyncModeFull,
		directory:   dir,
		locals:      locals,
		emailOwners: map[string]uuid.UUID{"taken@corp.local": uuid.New()},
		departments: fakeDepartments{"ou=platform,ou=rd,dc=corp,dc=local": platform},
	})
	if err != nil {
		t.Fatal(err)
	}
	actions := map[string]string{}
	for _, p := range planned {
		actions[p.item.Username+"|"+p.item.DN] = p.item.Action
	}
	expect := map[string]string{
		"zhangsan|CN=ZS,OU=Platform,OU=RD,DC=corp,DC=local": domain.SyncActionUnchanged,
		"newbie|CN=New,OU=Sales,DC=corp,DC=local":           domain.SyncActionCreate,
		"renamed|CN=Ren,OU=Platform,OU=RD,DC=corp,DC=local": domain.SyncActionUpdate,
		"disabled|CN=Dis,OU=RD,DC=corp,DC=local":            domain.SyncActionSkip,
		"newbie|CN=Dup,OU=RD,DC=corp,DC=local":              domain.SyncActionConflict,
		"|CN=NoName,OU=RD,DC=corp,DC=local":                 domain.SyncActionSkip,
		"gone|":                                             domain.SyncActionDisable,
	}
	for key, want := range expect {
		if actions[key] != want {
			t.Fatalf("%s: got %q want %q (all: %v)", key, actions[key], want, actions)
		}
	}
	for _, p := range planned {
		if p.item.Username == "newbie" && p.item.Action == domain.SyncActionCreate && p.values["email"] != "" {
			t.Fatalf("email owned by another account must be dropped: %+v", p.values)
		}
		if p.item.Username == "renamed" && !slices.Contains(p.item.Changes, "username") {
			t.Fatalf("rename not detected: %+v", p.item.Changes)
		}
	}
	if summary.Create != 1 || summary.Disable != 1 || summary.Conflict != 1 || summary.Skip != 2 || summary.Total != len(planned) {
		t.Fatalf("summary: %+v", summary)
	}
	if !slices.Contains(toCreate, "Sales") {
		t.Fatalf("departments to create: %v", toCreate)
	}
	incremental, _, _, _ := buildSyncPlan(t.Context(), syncInputs{cfg: cfg, mode: domain.SyncModeIncremental, directory: dir[:1], locals: locals, departments: fakeDepartments{}})
	if slices.ContainsFunc(incremental, func(p plannedUser) bool { return p.item.Action == domain.SyncActionDisable }) {
		t.Fatal("incremental sync must never disable missing accounts")
	}
}
