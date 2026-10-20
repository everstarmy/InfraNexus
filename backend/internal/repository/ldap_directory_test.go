package repository

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"gorm.io/datatypes"

	"infranexus/internal/domain"
	"infranexus/internal/testutil/ldaptest"
)

const (
	testBindDN = "CN=svc-infranexus,OU=Service,DC=corp,DC=local"
	testBindPW = "Bind!Secret1"
	testBaseDN = "DC=corp,DC=local"
)

var zhangsanGUID = string([]byte{0xE0, 0x04, 0x25, 0x3F, 0x89, 0x4F, 0xD3, 0x11, 0x9A, 0x0C, 0x03, 0x05, 0xE8, 0x2C, 0x33, 0x01})

func adEntry(dn, sam, display, mail, dept, guid, uac, changed, password string) ldaptest.Entry {
	return ldaptest.Entry{DN: dn, Password: password, Attrs: map[string][]string{
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

func directoryFixture(t *testing.T) (*ldaptest.Server, *domain.LDAPConfig) {
	t.Helper()
	srv := ldaptest.Start(t, testBindDN, testBindPW,
		adEntry("CN=Zhang San,OU=Platform,OU=RD,DC=corp,DC=local", "zhangsan", "张三", "zhangsan@corp.local", "研发部", zhangsanGUID, "512", "20261001000000.0Z", "Pa55!word"),
		adEntry("CN=Li Si,OU=RD,DC=corp,DC=local", "lisi", "李四", "lisi@corp.local", "研发部", "guid-lisi-0000000", "514", "20261010000000.0Z", "Pa55!word"),
		adEntry("CN=Wang Wu,OU=Sales,DC=corp,DC=local", "wangwu", "王五", "", "销售部", "guid-wangwu-00000", "512", "20261020000000.0Z", "Pa55!word"),
	)
	cfg := &domain.LDAPConfig{
		Type:           domain.DirectoryTypeAD,
		Domain:         "corp.local",
		ServerHost:     srv.Host,
		Port:           srv.Port,
		BindDN:         testBindDN,
		BaseDN:         testBaseDN,
		UserFilter:     "(&(objectClass=user)(sAMAccountName=%s))",
		TimeoutSeconds: 5,
		AttributeMapping: datatypes.NewJSONType(domain.LDAPAttributeMapping{
			Username: "sAMAccountName", Email: "mail", Nickname: "displayName", Department: "department", ExternalID: "objectGUID",
		}),
	}
	return srv, cfg
}

func TestGatewayAuthenticateVerifiesCredentialsAndMapsAttributes(t *testing.T) {
	srv, cfg := directoryFixture(t)
	gw := NewLDAPGateway()
	ctx := t.Context()
	user, err := gw.Authenticate(ctx, cfg, testBindPW, "zhangsan", "Pa55!word")
	if err != nil {
		t.Fatal(err)
	}
	if user.ExternalID != "3f2504e0-4f89-11d3-9a0c-0305e82c3301" || user.Nickname != "张三" || user.Department != "研发部" || user.Disabled {
		t.Fatalf("mapped user: %+v", user)
	}
	if !strings.EqualFold(user.DN, "CN=Zhang San,OU=Platform,OU=RD,DC=corp,DC=local") {
		t.Fatalf("dn: %s", user.DN)
	}
	for _, tc := range []struct {
		username, password string
		want               error
	}{
		{"zhangsan", "wrong", domain.ErrDirectoryInvalidCredentials},
		{"nobody", "Pa55!word", domain.ErrDirectoryInvalidCredentials},
		{"*", "Pa55!word", domain.ErrDirectoryInvalidCredentials},
		{"lisi", "Pa55!word", domain.ErrDirectoryAccountDisabled},
	} {
		if _, err := gw.Authenticate(ctx, cfg, testBindPW, tc.username, tc.password); !errors.Is(err, tc.want) {
			t.Fatalf("%s: got %v want %v", tc.username, err, tc.want)
		}
	}
	before := len(srv.BindAttempts())
	if _, err := gw.Authenticate(ctx, cfg, testBindPW, "zhangsan", ""); !errors.Is(err, domain.ErrDirectoryInvalidCredentials) {
		t.Fatalf("empty password: %v", err)
	}
	if len(srv.BindAttempts()) != before {
		t.Fatal("empty password must be rejected before any bind (unauthenticated bind would succeed)")
	}
	if !slices.ContainsFunc(srv.Searches(), func(f string) bool { return strings.Contains(f, `\2a`) }) {
		t.Fatalf("username was not escaped in filter: %v", srv.Searches())
	}
	if _, err := gw.Authenticate(ctx, cfg, "wrong-bind", "zhangsan", "Pa55!word"); !errors.Is(err, domain.ErrDirectoryBindFailed) {
		t.Fatalf("bad service account: %v", err)
	}
	offline := *cfg
	offline.Port = 1
	if _, err := gw.Authenticate(ctx, &offline, testBindPW, "zhangsan", "Pa55!word"); !errors.Is(err, domain.ErrDirectoryUnavailable) {
		t.Fatalf("unreachable server: %v", err)
	}
}

func TestGatewaySearchUsersSupportsIncrementalChanges(t *testing.T) {
	_, cfg := directoryFixture(t)
	gw := NewLDAPGateway()
	all, err := gw.SearchUsers(t.Context(), cfg, testBindPW, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("full search returned %d users", len(all))
	}
	disabled := slices.IndexFunc(all, func(u domain.DirectoryUser) bool { return u.Username == "lisi" })
	if disabled < 0 || !all[disabled].Disabled {
		t.Fatalf("disabled flag not mapped: %+v", all)
	}
	since := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	changed, err := gw.SearchUsers(t.Context(), cfg, testBindPW, &since)
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 2 || slices.ContainsFunc(changed, func(u domain.DirectoryUser) bool { return u.Username == "zhangsan" }) {
		t.Fatalf("incremental search: %+v", changed)
	}
}

func TestGatewayConnectionTestReportsFailingStage(t *testing.T) {
	_, cfg := directoryFixture(t)
	gw := NewLDAPGateway()
	ok, err := gw.Test(t.Context(), cfg, testBindPW)
	if err != nil || !ok.Success || ok.Stage != "done" || len(ok.SampleUsers) == 0 {
		t.Fatalf("successful test: %+v %v", ok, err)
	}
	bad, err := gw.Test(t.Context(), cfg, "wrong")
	if err != nil || bad.Success || bad.Stage != "bind" {
		t.Fatalf("bind failure: %+v %v", bad, err)
	}
	offline := *cfg
	offline.Port = 1
	down, err := gw.Test(t.Context(), &offline, testBindPW)
	if err != nil || down.Success || down.Stage != "connect" {
		t.Fatalf("connect failure: %+v %v", down, err)
	}
}
