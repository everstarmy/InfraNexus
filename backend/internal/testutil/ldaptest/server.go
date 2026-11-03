package ldaptest

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	ber "github.com/go-asn1-ber/asn1-ber"
	"github.com/go-ldap/ldap/v3"
	"github.com/jimlambrt/gldap"
)

type Entry struct {
	DN       string
	Password string
	Attrs    map[string][]string
}

type Server struct {
	Host string
	Port int

	srv          *gldap.Server
	bindDN       string
	bindPassword string

	mu       sync.Mutex
	entries  []Entry
	binds    []string
	searches []string
}

func Start(t testing.TB, bindDN, bindPassword string, entries ...Entry) *Server {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	s := &Server{Host: "127.0.0.1", Port: port, bindDN: bindDN, bindPassword: bindPassword, entries: entries}
	srv, err := gldap.NewServer()
	if err != nil {
		t.Fatal(err)
	}
	mux, err := gldap.NewMux()
	if err != nil {
		t.Fatal(err)
	}
	if err := mux.Bind(s.handleBind); err != nil {
		t.Fatal(err)
	}
	if err := mux.Search(s.handleSearch); err != nil {
		t.Fatal(err)
	}
	if err := srv.Router(mux); err != nil {
		t.Fatal(err)
	}
	s.srv = srv
	go func() { _ = srv.Run(fmt.Sprintf("%s:%d", s.Host, s.Port)) }()
	deadline := time.Now().Add(5 * time.Second)
	for !srv.Ready() {
		if time.Now().After(deadline) {
			t.Fatal("ldap test server did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Cleanup(func() { _ = srv.Stop() })
	return s
}

func (s *Server) SetEntries(entries ...Entry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = entries
}

func (s *Server) BindAttempts() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.binds...)
}

func (s *Server) Searches() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.searches...)
}

func (s *Server) handleBind(w *gldap.ResponseWriter, r *gldap.Request) {
	resp := r.NewBindResponse(gldap.WithResponseCode(gldap.ResultInvalidCredentials))
	defer func() { _ = w.Write(resp) }()
	msg, err := r.GetSimpleBindMessage()
	if err != nil {
		return
	}
	password := string(msg.Password)
	s.mu.Lock()
	s.binds = append(s.binds, msg.UserName)
	entries := s.entries
	s.mu.Unlock()
	if strings.EqualFold(msg.UserName, s.bindDN) && password == s.bindPassword {
		resp.SetResultCode(gldap.ResultSuccess)
		return
	}
	if password == "" {
		resp.SetResultCode(gldap.ResultSuccess)
		return
	}
	for _, e := range entries {
		if strings.EqualFold(e.DN, msg.UserName) && e.Password != "" && e.Password == password {
			resp.SetResultCode(gldap.ResultSuccess)
			return
		}
	}
}

func (s *Server) handleSearch(w *gldap.ResponseWriter, r *gldap.Request) {
	done := r.NewSearchDoneResponse(gldap.WithResponseCode(gldap.ResultSuccess))
	defer func() { _ = w.Write(done) }()
	msg, err := r.GetSearchMessage()
	if err != nil {
		done.SetResultCode(gldap.ResultOperationsError)
		return
	}
	filter, err := ldap.CompileFilter(msg.Filter)
	if err != nil {
		done.SetResultCode(gldap.ResultOperationsError)
		return
	}
	s.mu.Lock()
	s.searches = append(s.searches, msg.Filter)
	entries := s.entries
	s.mu.Unlock()
	sent := int64(0)
	for _, e := range entries {
		if !underBase(e.DN, msg.BaseDN) || !matches(filter, e) {
			continue
		}
		if msg.SizeLimit > 0 && sent >= msg.SizeLimit {
			done.SetResultCode(gldap.ResultSizeLimitExceeded)
			return
		}
		_ = w.Write(r.NewSearchResponseEntry(e.DN, gldap.WithAttributes(e.Attrs)))
		sent++
	}
}

func underBase(dn, base string) bool {
	dn, base = strings.ToLower(dn), strings.ToLower(base)
	return dn == base || strings.HasSuffix(dn, ","+base)
}

func values(e Entry, attr string) []string {
	for name, vals := range e.Attrs {
		if strings.EqualFold(name, attr) {
			return vals
		}
	}
	return nil
}

func matches(p *ber.Packet, e Entry) bool {
	switch p.Tag {
	case ldap.FilterAnd:
		for _, child := range p.Children {
			if !matches(child, e) {
				return false
			}
		}
		return true
	case ldap.FilterOr:
		for _, child := range p.Children {
			if matches(child, e) {
				return true
			}
		}
		return false
	case ldap.FilterNot:
		return len(p.Children) == 1 && !matches(p.Children[0], e)
	case ldap.FilterPresent:
		return len(values(e, p.Data.String())) > 0
	case ldap.FilterEqualityMatch, ldap.FilterApproxMatch:
		attr, want := p.Children[0].Data.String(), p.Children[1].Data.String()
		for _, v := range values(e, attr) {
			if strings.EqualFold(v, want) {
				return true
			}
		}
		return false
	case ldap.FilterGreaterOrEqual:
		attr, want := p.Children[0].Data.String(), p.Children[1].Data.String()
		for _, v := range values(e, attr) {
			if v >= want {
				return true
			}
		}
		return false
	case ldap.FilterLessOrEqual:
		attr, want := p.Children[0].Data.String(), p.Children[1].Data.String()
		for _, v := range values(e, attr) {
			if v <= want {
				return true
			}
		}
		return false
	case ldap.FilterSubstrings:
		attr := p.Children[0].Data.String()
		for _, v := range values(e, attr) {
			if substringMatch(strings.ToLower(v), p.Children[1].Children) {
				return true
			}
		}
		return false
	}
	return false
}

func substringMatch(value string, parts []*ber.Packet) bool {
	pos := 0
	for i, part := range parts {
		piece := strings.ToLower(part.Data.String())
		switch part.Tag {
		case ldap.FilterSubstringsInitial:
			if !strings.HasPrefix(value, piece) {
				return false
			}
			pos = len(piece)
		case ldap.FilterSubstringsAny:
			idx := strings.Index(value[pos:], piece)
			if idx < 0 {
				return false
			}
			pos += idx + len(piece)
		case ldap.FilterSubstringsFinal:
			if i != len(parts)-1 || !strings.HasSuffix(value[pos:], piece) {
				return false
			}
		}
	}
	return true
}
