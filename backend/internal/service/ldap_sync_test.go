package service

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"
	"gorm.io/datatypes"

	"infranexus/internal/domain"
)

func syncConfig(strategy string, mappings ...domain.OUMapping) *domain.LDAPConfig {
	return &domain.LDAPConfig{
		Type:                domain.DirectoryTypeAD,
		Domain:              "corp.local",
		BaseDN:              "DC=corp,DC=local",
		DisableMissingUsers: true,
		DepartmentSync:      datatypes.NewJSONType(domain.LDAPDepartmentSync{Strategy: strategy, OUMappings: mappings}),
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
