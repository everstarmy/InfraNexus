package bootstrap

import (
	"context"
	"crypto/tls"
	"net"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-ldap/ldap/v3"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
)

func liveDirectoryConnection(t *testing.T, ctx context.Context, cfg *domain.LDAPConfig) *ldap.Conn {
	t.Helper()
	network, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(cfg.ServerHost, strconv.Itoa(cfg.Port)))
	if err != nil {
		t.Fatal("live directory connection failed")
	}
	tlsConfig := &tls.Config{ServerName: cfg.ServerHost, MinVersion: tls.VersionTLS12}
	if cfg.UseSSL {
		secured := tls.Client(network, tlsConfig)
		if err := secured.HandshakeContext(ctx); err != nil {
			_ = network.Close()
			t.Fatal("live directory certificate-verified TLS handshake failed")
		}
		network = secured
	}
	conn := ldap.NewConn(network, cfg.UseSSL)
	conn.SetTimeout(10 * time.Second)
	conn.Start()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	t.Cleanup(func() { stop(); _ = conn.Close() })
	if cfg.StartTLS {
		if err := conn.StartTLS(tlsConfig); err != nil {
			t.Fatal("live directory certificate-verified StartTLS failed")
		}
	}
	return conn
}

// A small page proves real server-side paging/cookie round trips without creating
// directory entries. It does not claim a 500+ user production-scale acceptance.
func TestLiveADRootDSEAndPagingReadOnly(t *testing.T) {
	cfg, password, _ := liveADConfig(t)
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	conn := liveDirectoryConnection(t, ctx, cfg)
	if err := conn.Bind(cfg.BindDN, password); err != nil {
		t.Fatal("live directory service bind failed")
	}
	root, err := conn.Search(ldap.NewSearchRequest("", ldap.ScopeBaseObject, ldap.NeverDerefAliases, 1, 5, false,
		"(objectClass=*)", []string{"defaultNamingContext", "supportedControl", "supportedExtension"}, nil))
	if err != nil || len(root.Entries) != 1 {
		t.Fatal("live directory RootDSE query failed")
	}
	entry := root.Entries[0]
	naming := entry.GetAttributeValue("defaultNamingContext")
	if naming == "" || !strings.HasSuffix(strings.ToLower(cfg.BaseDN), strings.ToLower(naming)) {
		t.Fatal("configured Base DN does not belong to the AD naming context")
	}
	if !slices.Contains(entry.GetAttributeValues("supportedControl"), ldap.ControlTypePaging) {
		t.Fatal("directory does not advertise paged results support")
	}
	expected, err := repository.NewLDAPGateway().SearchUsers(ctx, cfg, password, nil)
	if err != nil || len(expected) == 0 || len(expected) > 2000 {
		t.Fatal("live directory reference search failed or exceeds fixture bounds")
	}
	wanted := make(map[string]bool, len(expected))
	for _, user := range expected {
		wanted[strings.ToLower(user.Username)] = true
	}
	seen := make(map[string]bool, len(expected))
	paging := ldap.NewControlPaging(2)
	pages := 0
	for {
		pages++
		if pages > len(expected)+1 {
			t.Fatal("directory paging did not terminate within its row bound")
		}
		page, err := conn.Search(ldap.NewSearchRequest(cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 5, false,
			strings.ReplaceAll(cfg.UserFilter, "%s", "*"), []string{"sAMAccountName", "objectGUID"}, []ldap.Control{paging}))
		if err != nil {
			t.Fatal("live directory page search failed")
		}
		for _, user := range page.Entries {
			name := strings.ToLower(user.GetAttributeValue("sAMAccountName"))
			if !wanted[name] || seen[name] || len(user.GetRawAttributeValue("objectGUID")) != 16 {
				t.Fatal("paged directory identity is duplicate, unknown, or missing its stable GUID")
			}
			seen[name] = true
		}
		control, ok := ldap.FindControl(page.Controls, ldap.ControlTypePaging).(*ldap.ControlPaging)
		if !ok {
			t.Fatal("directory omitted the paging response control")
		}
		if len(control.Cookie) == 0 {
			break
		}
		paging.SetCookie(control.Cookie)
	}
	if len(seen) != len(wanted) || (len(wanted) > 2 && pages < 2) {
		t.Fatal("real paged search did not return the complete reference identity set")
	}
	startTLSAdvertised := slices.Contains(entry.GetAttributeValues("supportedExtension"), "1.3.6.1.4.1.1466.20037")
	tlsVerified := cfg.UseSSL || cfg.StartTLS
	if startTLSAdvertised && !tlsVerified {
		probe := liveDirectoryConnection(t, ctx, cfg)
		// No credentials are sent on this new connection. A refused/untrusted
		// upgrade is recorded as capability evidence, never called TLS success.
		tlsVerified = probe.StartTLS(&tls.Config{ServerName: cfg.ServerHost, MinVersion: tls.VersionTLS12}) == nil
	}
	t.Logf("live AD protocol passed: page_size=2 pages=%d identities=%d complete=true start_tls_advertised=%t tls_verified=%t production_page_size=500", pages, len(seen), startTLSAdvertised, tlsVerified)
}
