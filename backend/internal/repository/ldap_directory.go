package repository

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/google/uuid"

	"infranexus/internal/domain"
)

const (
	defaultDirectoryTimeout = 10 * time.Second
	directoryPageSize       = 500
	adDisabledFlag          = 0x2
)

type ldapGateway struct{}

func NewLDAPGateway() domain.DirectoryGateway {
	return &ldapGateway{}
}

func DirectoryServerURL(cfg *domain.LDAPConfig) string {
	scheme := "ldap"
	if cfg.UseSSL {
		scheme = "ldaps"
	}
	return scheme + "://" + net.JoinHostPort(cfg.ServerHost, strconv.Itoa(cfg.Port))
}

func directoryTimeout(cfg *domain.LDAPConfig) time.Duration {
	if cfg.TimeoutSeconds > 0 {
		return time.Duration(cfg.TimeoutSeconds) * time.Second
	}
	return defaultDirectoryTimeout
}

func unavailable(err error) error {
	return fmt.Errorf("%w: %v", domain.ErrDirectoryUnavailable, err)
}

func (g *ldapGateway) connect(cfg *domain.LDAPConfig) (*ldap.Conn, error) {
	timeout := directoryTimeout(cfg)
	tlsConfig := &tls.Config{ServerName: cfg.ServerHost, InsecureSkipVerify: cfg.InsecureSkipVerify, MinVersion: tls.VersionTLS12}
	conn, err := ldap.DialURL(DirectoryServerURL(cfg), ldap.DialWithDialer(&net.Dialer{Timeout: timeout}), ldap.DialWithTLSConfig(tlsConfig))
	if err != nil {
		return nil, unavailable(err)
	}
	conn.SetTimeout(timeout)
	if cfg.StartTLS && !cfg.UseSSL {
		if err := conn.StartTLS(tlsConfig); err != nil {
			_ = conn.Close()
			return nil, unavailable(err)
		}
	}
	return conn, nil
}

func (g *ldapGateway) serviceBind(conn *ldap.Conn, cfg *domain.LDAPConfig, bindPassword string) error {
	if err := conn.Bind(cfg.BindDN, bindPassword); err != nil {
		if ldap.IsErrorWithCode(err, ldap.LDAPResultInvalidCredentials) || ldap.IsErrorWithCode(err, ldap.ErrorEmptyPassword) {
			return fmt.Errorf("%w: %v", domain.ErrDirectoryBindFailed, err)
		}
		return unavailable(err)
	}
	return nil
}

func mappedAttributes(cfg *domain.LDAPConfig) []string {
	m := cfg.AttributeMapping.Data()
	attrs := make([]string, 0, 6)
	for _, a := range []string{m.Username, m.Email, m.Nickname, m.Department, m.ExternalID} {
		if a != "" {
			attrs = append(attrs, a)
		}
	}
	if cfg.Type == domain.DirectoryTypeAD {
		attrs = append(attrs, "userAccountControl")
	}
	return attrs
}

func toDirectoryUser(entry *ldap.Entry, cfg *domain.LDAPConfig) domain.DirectoryUser {
	m := cfg.AttributeMapping.Data()
	get := func(attr string) string {
		if attr == "" {
			return ""
		}
		return strings.TrimSpace(entry.GetEqualFoldAttributeValue(attr))
	}
	user := domain.DirectoryUser{
		DN:         entry.DN,
		Username:   get(m.Username),
		Email:      get(m.Email),
		Nickname:   get(m.Nickname),
		Department: get(m.Department),
		ExternalID: externalID(entry, m.ExternalID),
	}
	if cfg.Type == domain.DirectoryTypeAD {
		if uac, err := strconv.Atoi(get("userAccountControl")); err == nil {
			user.Disabled = uac&adDisabledFlag != 0
		}
	}
	return user
}

func externalID(entry *ldap.Entry, attr string) string {
	if attr == "" {
		return ""
	}
	if strings.EqualFold(attr, "objectGUID") {
		if raw := entry.GetEqualFoldRawAttributeValue(attr); len(raw) == 16 {
			return FormatObjectGUID(raw)
		}
	}
	return strings.TrimSpace(entry.GetEqualFoldAttributeValue(attr))
}

func FormatObjectGUID(raw []byte) string {
	var u uuid.UUID
	binary.BigEndian.PutUint32(u[0:4], binary.LittleEndian.Uint32(raw[0:4]))
	binary.BigEndian.PutUint16(u[4:6], binary.LittleEndian.Uint16(raw[4:6]))
	binary.BigEndian.PutUint16(u[6:8], binary.LittleEndian.Uint16(raw[6:8]))
	copy(u[8:], raw[8:16])
	return u.String()
}

func (g *ldapGateway) Authenticate(ctx context.Context, cfg *domain.LDAPConfig, bindPassword, username, password string) (*domain.DirectoryUser, error) {
	if strings.TrimSpace(username) == "" || password == "" {
		return nil, domain.ErrDirectoryInvalidCredentials
	}
	conn, err := g.connect(cfg)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := g.serviceBind(conn, cfg, bindPassword); err != nil {
		return nil, err
	}
	filter := strings.ReplaceAll(cfg.UserFilter, "%s", ldap.EscapeFilter(username))
	req := ldap.NewSearchRequest(cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, int(directoryTimeout(cfg).Seconds()), false, filter, mappedAttributes(cfg), nil)
	result, err := conn.Search(req)
	if err != nil {
		if ldap.IsErrorWithCode(err, ldap.LDAPResultSizeLimitExceeded) {
			return nil, domain.ErrDirectoryInvalidCredentials
		}
		return nil, unavailable(err)
	}
	if len(result.Entries) != 1 {
		return nil, domain.ErrDirectoryInvalidCredentials
	}
	user := toDirectoryUser(result.Entries[0], cfg)
	if user.Disabled {
		return nil, domain.ErrDirectoryAccountDisabled
	}
	if err := conn.Bind(result.Entries[0].DN, password); err != nil {
		if ldap.IsErrorWithCode(err, ldap.LDAPResultInvalidCredentials) || ldap.IsErrorWithCode(err, ldap.ErrorEmptyPassword) {
			return nil, domain.ErrDirectoryInvalidCredentials
		}
		return nil, unavailable(err)
	}
	return &user, nil
}

func (g *ldapGateway) SearchUsers(ctx context.Context, cfg *domain.LDAPConfig, bindPassword string, changedSince *time.Time) ([]domain.DirectoryUser, error) {
	conn, err := g.connect(cfg)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := g.serviceBind(conn, cfg, bindPassword); err != nil {
		return nil, err
	}
	filter := strings.ReplaceAll(cfg.UserFilter, "%s", "*")
	if changedSince != nil {
		attr, stamp := "modifyTimestamp", changedSince.UTC().Format("20060102150405")+"Z"
		if cfg.Type == domain.DirectoryTypeAD {
			attr, stamp = "whenChanged", changedSince.UTC().Format("20060102150405")+".0Z"
		}
		filter = fmt.Sprintf("(&%s(%s>=%s))", filter, attr, stamp)
	}
	req := ldap.NewSearchRequest(cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, filter, mappedAttributes(cfg), nil)
	result, err := conn.SearchWithPaging(req, directoryPageSize)
	if err != nil {
		return nil, unavailable(err)
	}
	users := make([]domain.DirectoryUser, 0, len(result.Entries))
	for _, entry := range result.Entries {
		users = append(users, toDirectoryUser(entry, cfg))
	}
	return users, nil
}

func (g *ldapGateway) Test(ctx context.Context, cfg *domain.LDAPConfig, bindPassword string) (*domain.LDAPTestResult, error) {
	start := time.Now()
	result := &domain.LDAPTestResult{ServerURL: DirectoryServerURL(cfg), SampleUsers: []string{}, Stage: "connect"}
	finish := func(message string) (*domain.LDAPTestResult, error) {
		result.Message = message
		result.LatencyMs = time.Since(start).Milliseconds()
		return result, nil
	}
	conn, err := g.connect(cfg)
	if err != nil {
		return finish("无法连接目录服务器：" + strings.TrimPrefix(err.Error(), domain.ErrDirectoryUnavailable.Error()+": "))
	}
	defer conn.Close()
	result.Stage = "bind"
	if err := g.serviceBind(conn, cfg, bindPassword); err != nil {
		if errors.Is(err, domain.ErrDirectoryBindFailed) {
			return finish("服务账号（Bind DN）或密码错误")
		}
		return finish("绑定服务账号失败：" + strings.TrimPrefix(err.Error(), domain.ErrDirectoryUnavailable.Error()+": "))
	}
	result.Stage = "search"
	filter := strings.ReplaceAll(cfg.UserFilter, "%s", "*")
	req := ldap.NewSearchRequest(cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 5, int(directoryTimeout(cfg).Seconds()), false, filter, mappedAttributes(cfg), nil)
	found, err := conn.Search(req)
	if err != nil && !ldap.IsErrorWithCode(err, ldap.LDAPResultSizeLimitExceeded) {
		return finish("用户检索失败，请检查 Base DN 与用户过滤器：" + err.Error())
	}
	if found != nil {
		for _, entry := range found.Entries {
			if u := toDirectoryUser(entry, cfg); u.Username != "" {
				result.SampleUsers = append(result.SampleUsers, u.Username)
			}
		}
	}
	result.Stage = "done"
	result.Success = true
	return finish(fmt.Sprintf("连接成功，已读取 %d 个示例账号", len(result.SampleUsers)))
}
