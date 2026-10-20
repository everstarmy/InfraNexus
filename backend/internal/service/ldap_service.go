package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/secret"
	"infranexus/internal/domain"
)

const (
	syncLockStaleAfter = 2 * time.Hour
	previewItemLimit   = 500
	reportErrorLimit   = 200
)

type LDAPServiceDeps struct {
	Repo        domain.LDAPRepository
	Users       domain.UserRepository
	Roles       domain.RoleRepository
	Departments domain.DepartmentRepository
	Gateway     domain.DirectoryGateway
	Cipher      *secret.Cipher
	Events      domain.EventPublisher
	Logger      *slog.Logger
}

type ldapService struct {
	LDAPServiceDeps
	now    func() time.Time
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func NewLDAPService(deps LDAPServiceDeps) domain.LDAPService {
	if deps.Logger == nil {
		deps.Logger = slog.Default()
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &ldapService{LDAPServiceDeps: deps, now: time.Now, ctx: ctx, cancel: cancel}
}

func (s *ldapService) Close() {
	s.cancel()
	s.wg.Wait()
}

func (s *ldapService) publish(event string, data any) {
	if s.Events != nil {
		s.Events.Publish(event, data)
	}
}

func defaultAttributeMapping(kind string) domain.LDAPAttributeMapping {
	if kind == domain.DirectoryTypeLDAP {
		return domain.LDAPAttributeMapping{Username: "uid", Email: "mail", Nickname: "cn", Department: "ou", ExternalID: "entryUUID"}
	}
	return domain.LDAPAttributeMapping{Username: "sAMAccountName", Email: "mail", Nickname: "displayName", Department: "department", ExternalID: "objectGUID"}
}

func withMappingDefaults(kind string, m domain.LDAPAttributeMapping) domain.LDAPAttributeMapping {
	d := defaultAttributeMapping(kind)
	for _, pair := range []struct {
		value *string
		def   string
	}{{&m.Username, d.Username}, {&m.Email, d.Email}, {&m.Nickname, d.Nickname}, {&m.Department, d.Department}, {&m.ExternalID, d.ExternalID}} {
		*pair.value = strings.TrimSpace(*pair.value)
		if *pair.value == "" {
			*pair.value = pair.def
		}
	}
	return m
}

func withPublicFields(cfg *domain.LDAPConfig) *domain.LDAPConfig {
	cfg.HasBindPassword = cfg.BindPassword != ""
	return cfg
}

func (s *ldapService) ListConfigs(ctx context.Context) ([]domain.LDAPConfig, error) {
	configs, err := s.Repo.ListConfigs(ctx)
	if err != nil {
		return nil, err
	}
	for i := range configs {
		withPublicFields(&configs[i])
	}
	return configs, nil
}

func (s *ldapService) GetConfig(ctx context.Context, id uuid.UUID) (*domain.LDAPConfig, error) {
	cfg, err := s.Repo.GetConfig(ctx, id)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDirectoryConfigNotFound)
	}
	return withPublicFields(cfg), nil
}

func buildConfig(cfg *domain.LDAPConfig, req domain.LDAPConfigRequest) error {
	if req.UseSSL && req.StartTLS {
		return coreerrors.ErrParamInvalid.WithMessage("LDAPS 与 StartTLS 只能二选一")
	}
	if !strings.Contains(req.UserFilter, "%s") {
		return coreerrors.ErrParamInvalid.WithMessage("用户过滤器必须包含 %s 占位符")
	}
	if _, err := NormalizeDN(req.BaseDN); err != nil {
		return coreerrors.ErrParamInvalid.WithMessage("Base DN 格式非法")
	}
	opts := req.DepartmentSync
	if opts.Strategy == "" {
		opts.Strategy = domain.DeptStrategyNone
	}
	for _, m := range opts.OUMappings {
		if _, err := NormalizeDN(m.OUDN); err != nil {
			return coreerrors.ErrParamInvalid.WithMessage("OU 映射中的 DN 格式非法：" + m.OUDN)
		}
	}
	cfg.Name = strings.TrimSpace(req.Name)
	cfg.Type = req.Type
	cfg.Domain = strings.ToLower(strings.TrimSpace(req.Domain))
	cfg.ServerHost = strings.TrimSpace(req.ServerHost)
	cfg.Port = req.Port
	cfg.UseSSL = req.UseSSL
	cfg.StartTLS = req.StartTLS
	cfg.InsecureSkipVerify = req.InsecureSkipVerify
	cfg.BindDN = strings.TrimSpace(req.BindDN)
	cfg.BaseDN = strings.TrimSpace(req.BaseDN)
	cfg.UserFilter = strings.TrimSpace(req.UserFilter)
	cfg.AttributeMapping = datatypes.NewJSONType(withMappingDefaults(req.Type, req.AttributeMapping))
	cfg.DepartmentSync = datatypes.NewJSONType(opts)
	cfg.DefaultRoleID = req.DefaultRoleID
	cfg.Enabled = req.Enabled
	cfg.SyncEnabled = req.SyncEnabled
	cfg.DisableMissingUsers = req.DisableMissingUsers
	cfg.SyncIntervalMinutes = req.SyncIntervalMinutes
	if cfg.SyncIntervalMinutes == 0 {
		cfg.SyncIntervalMinutes = 60
	}
	if cfg.SyncEnabled && cfg.SyncIntervalMinutes < 5 {
		return coreerrors.ErrParamInvalid.WithMessage("定时同步间隔至少 5 分钟")
	}
	cfg.TimeoutSeconds = req.TimeoutSeconds
	if cfg.TimeoutSeconds == 0 {
		cfg.TimeoutSeconds = 10
	}
	return nil
}

func (s *ldapService) checkReferences(ctx context.Context, cfg *domain.LDAPConfig) error {
	if cfg.Domain == "local" {
		return coreerrors.ErrParamInvalid.WithMessage("local 为保留的本地认证域")
	}
	if existing, err := s.Repo.GetConfigByDomain(ctx, cfg.Domain); err == nil && existing.ID != cfg.ID {
		return coreerrors.ErrResourceConflict.WithMessage("该认证域已存在目录配置")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if cfg.DefaultRoleID != nil {
		if _, err := s.Roles.GetByID(ctx, *cfg.DefaultRoleID); err != nil {
			return notFoundAs(err, coreerrors.ErrRoleNotFound.WithMessage("默认角色不存在"))
		}
	}
	opts := cfg.DepartmentSync.Data()
	ids := make([]uuid.UUID, 0, len(opts.OUMappings)+1)
	if opts.RootDepartmentID != nil {
		ids = append(ids, *opts.RootDepartmentID)
	}
	for _, m := range opts.OUMappings {
		ids = append(ids, m.DepartmentID)
	}
	for _, id := range ids {
		if _, err := s.Departments.GetByID(ctx, id); err != nil {
			return notFoundAs(err, coreerrors.ErrDepartmentNotFound.WithMessage("部门映射引用的部门不存在"))
		}
	}
	return nil
}

func (s *ldapService) CreateConfig(ctx context.Context, req domain.LDAPConfigRequest) (*domain.LDAPConfig, error) {
	cfg := &domain.LDAPConfig{SyncStatus: domain.SyncStatusIdle}
	if err := buildConfig(cfg, req); err != nil {
		return nil, err
	}
	if err := s.checkReferences(ctx, cfg); err != nil {
		return nil, err
	}
	if req.BindPassword == "" {
		return nil, coreerrors.ErrParamInvalid.WithMessage("请填写服务账号密码")
	}
	encrypted, err := s.Cipher.Encrypt(req.BindPassword)
	if err != nil {
		return nil, err
	}
	cfg.BindPassword = encrypted
	if err := s.Repo.CreateConfig(ctx, cfg); err != nil {
		return nil, err
	}
	return withPublicFields(cfg), nil
}

func (s *ldapService) UpdateConfig(ctx context.Context, id uuid.UUID, req domain.LDAPConfigRequest) (*domain.LDAPConfig, error) {
	cfg, err := s.Repo.GetConfig(ctx, id)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDirectoryConfigNotFound)
	}
	if err := buildConfig(cfg, req); err != nil {
		return nil, err
	}
	if err := s.checkReferences(ctx, cfg); err != nil {
		return nil, err
	}
	if req.BindPassword != "" {
		encrypted, err := s.Cipher.Encrypt(req.BindPassword)
		if err != nil {
			return nil, err
		}
		cfg.BindPassword = encrypted
	}
	if err := s.Repo.SaveConfig(ctx, cfg); err != nil {
		return nil, err
	}
	return s.GetConfig(ctx, id)
}

func (s *ldapService) DeleteConfig(ctx context.Context, id uuid.UUID) error {
	if _, err := s.GetConfig(ctx, id); err != nil {
		return err
	}
	return s.Repo.DeleteConfig(ctx, id)
}

func (s *ldapService) bindPassword(cfg *domain.LDAPConfig) (string, error) {
	plain, err := s.Cipher.Decrypt(cfg.BindPassword)
	if err != nil {
		return "", coreerrors.ErrDirectoryUnavailable.WithMessage("已保存的服务账号密码无法解密（加密密钥可能已变更），请重新填写")
	}
	return plain, nil
}

func (s *ldapService) TestConnection(ctx context.Context, req domain.LDAPTestRequest) (*domain.LDAPTestResult, error) {
	cfg := &domain.LDAPConfig{}
	if err := buildConfig(cfg, req.LDAPConfigRequest); err != nil {
		return nil, err
	}
	password := req.BindPassword
	if password == "" && req.ConfigID != nil {
		stored, err := s.Repo.GetConfig(ctx, *req.ConfigID)
		if err != nil {
			return nil, notFoundAs(err, coreerrors.ErrDirectoryConfigNotFound)
		}
		if password, err = s.bindPassword(stored); err != nil {
			return nil, err
		}
	}
	return s.Gateway.Test(ctx, cfg, password)
}

func (s *ldapService) ListLoginDomains(ctx context.Context) ([]domain.AuthDomain, error) {
	configs, err := s.Repo.ListConfigs(ctx)
	if err != nil {
		return nil, err
	}
	domains := make([]domain.AuthDomain, 0, len(configs))
	for _, cfg := range configs {
		if cfg.Enabled {
			domains = append(domains, domain.AuthDomain{Domain: cfg.Domain, Name: cfg.Name, Type: cfg.Type})
		}
	}
	return domains, nil
}

func directoryFailure(log *slog.Logger, cfg *domain.LDAPConfig, err error) error {
	switch {
	case errors.Is(err, domain.ErrDirectoryBindFailed):
		log.Error("Directory service account bind failed", "domain", cfg.Domain, "error", err)
		return coreerrors.ErrDirectoryUnavailable.WithMessage("目录服务账号认证失败，请联系管理员检查目录配置")
	case errors.Is(err, domain.ErrDirectoryUnavailable):
		log.Error("Directory server unavailable", "domain", cfg.Domain, "error", err)
		return coreerrors.ErrDirectoryUnavailable
	}
	return err
}

func (s *ldapService) AuthenticateDomain(ctx context.Context, domainName, username, password string) (*domain.User, error) {
	cfg, err := s.Repo.GetConfigByDomain(ctx, strings.ToLower(strings.TrimSpace(domainName)))
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && !cfg.Enabled) {
		return nil, coreerrors.ErrDomainNotFound
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(username) == "" || password == "" {
		return nil, coreerrors.ErrDomainInvalidCredentials
	}
	bindPassword, err := s.bindPassword(cfg)
	if err != nil {
		return nil, err
	}
	du, err := s.Gateway.Authenticate(ctx, cfg, bindPassword, username, password)
	switch {
	case errors.Is(err, domain.ErrDirectoryInvalidCredentials):
		return nil, coreerrors.ErrDomainInvalidCredentials
	case errors.Is(err, domain.ErrDirectoryAccountDisabled):
		return nil, coreerrors.ErrAccountDisabled
	case err != nil:
		return nil, directoryFailure(s.Logger, cfg, err)
	}
	return s.provision(ctx, cfg, *du)
}

func (s *ldapService) provision(ctx context.Context, cfg *domain.LDAPConfig, du domain.DirectoryUser) (*domain.User, error) {
	locals := make([]domain.User, 0, 2)
	if du.ExternalID != "" {
		if u, err := s.Users.GetByExternalID(ctx, cfg.Domain, du.ExternalID); err == nil {
			locals = append(locals, *u)
		}
	}
	if u, err := s.Users.GetByUsername(ctx, cfg.Domain, strings.ToLower(strings.TrimSpace(du.Username))); err == nil && (len(locals) == 0 || locals[0].ID != u.ID) {
		locals = append(locals, *u)
	}
	owners := map[string]uuid.UUID{}
	if du.Email != "" {
		if u, err := s.Users.GetByEmail(ctx, du.Email); err == nil {
			owners[strings.ToLower(u.Email)] = u.ID
		}
	}
	resolver := newDepartmentResolver(s.Departments)
	planned, _, _, err := buildSyncPlan(ctx, syncInputs{cfg: cfg, mode: domain.SyncModeIncremental, directory: []domain.DirectoryUser{du}, locals: locals, emailOwners: owners, departments: resolver})
	if err != nil {
		return nil, err
	}
	if len(planned) != 1 {
		return nil, coreerrors.ErrDomainInvalidCredentials
	}
	p := planned[0]
	if p.item.Action == domain.SyncActionConflict || p.item.Action == domain.SyncActionSkip {
		return nil, coreerrors.ErrExternalAccountManaged.WithMessage("域账号与本地档案存在冲突，请联系管理员处理：" + p.item.Reason)
	}
	user, err := s.apply(ctx, cfg, resolver, p)
	if err != nil {
		return nil, err
	}
	if user.Status != domain.StatusEnabled {
		return nil, coreerrors.ErrAccountDisabled
	}
	return user, nil
}

func (s *ldapService) apply(ctx context.Context, cfg *domain.LDAPConfig, resolver *departmentResolver, p plannedUser) (*domain.User, error) {
	var deptID *uuid.UUID
	if p.target != nil && (p.item.Action == domain.SyncActionCreate || containsChange(p.item.Changes, "department")) {
		id, err := resolver.ensure(ctx, p.target)
		if err != nil {
			return nil, err
		}
		deptID = id
	}
	switch p.item.Action {
	case domain.SyncActionCreate:
		user := domain.User{
			Username:     p.item.Username,
			Domain:       cfg.Domain,
			AuthType:     cfg.Type,
			ExternalID:   p.dir.ExternalID,
			Email:        p.values["email"].(string),
			Nickname:     p.dir.Nickname,
			Status:       domain.StatusEnabled,
			DepartmentID: deptID,
		}
		if err := s.Users.Create(ctx, &user); err != nil {
			return nil, err
		}
		if cfg.DefaultRoleID != nil {
			if err := s.Users.AssignRoles(ctx, user.ID, []uuid.UUID{*cfg.DefaultRoleID}); err != nil {
				return nil, err
			}
		}
		return s.Users.GetByID(ctx, user.ID)
	case domain.SyncActionUpdate, domain.SyncActionDisable:
		values := make(map[string]any, len(p.values)+1)
		for k, v := range p.values {
			values[k] = v
		}
		if deptID != nil {
			values["department_id"] = *deptID
		}
		if len(values) > 0 {
			if err := s.Users.UpdateColumns(ctx, p.local.ID, values); err != nil {
				return nil, err
			}
		}
		return s.Users.GetByID(ctx, p.local.ID)
	}
	return p.local, nil
}

func containsChange(changes []string, change string) bool {
	for _, c := range changes {
		if c == change {
			return true
		}
	}
	return false
}

func (s *ldapService) plan(ctx context.Context, cfg *domain.LDAPConfig, mode string, resolver departmentLookup) ([]plannedUser, domain.SyncSummary, []string, error) {
	bindPassword, err := s.bindPassword(cfg)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, err
	}
	var since *time.Time
	if mode == domain.SyncModeIncremental {
		since = cfg.LastSuccessAt
	}
	directory, err := s.Gateway.SearchUsers(ctx, cfg, bindPassword, since)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, directoryFailure(s.Logger, cfg, err)
	}
	locals, err := s.Users.ListByDomain(ctx, cfg.Domain)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, err
	}
	owners, err := s.Users.EmailOwners(ctx)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, err
	}
	return buildSyncPlan(ctx, syncInputs{cfg: cfg, mode: mode, directory: directory, locals: locals, emailOwners: owners, departments: resolver})
}

func normalizeMode(mode string) string {
	if mode == domain.SyncModeIncremental {
		return mode
	}
	return domain.SyncModeFull
}

func (s *ldapService) Preview(ctx context.Context, configID uuid.UUID, mode string) (*domain.SyncPlan, error) {
	cfg, err := s.Repo.GetConfig(ctx, configID)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDirectoryConfigNotFound)
	}
	mode = normalizeMode(mode)
	planned, summary, toCreate, err := s.plan(ctx, cfg, mode, newDepartmentResolver(s.Departments))
	if err != nil {
		return nil, err
	}
	result := &domain.SyncPlan{ConfigID: cfg.ID, Domain: cfg.Domain, Mode: mode, GeneratedAt: s.now(), Summary: summary, DepartmentsToCreate: toCreate, Items: []domain.SyncPlanItem{}}
	for _, p := range planned {
		if len(result.Items) >= previewItemLimit {
			result.Truncated = true
			break
		}
		result.Items = append(result.Items, p.item)
	}
	return result, nil
}

func (s *ldapService) StartSync(ctx context.Context, configID uuid.UUID, mode, trigger string, operatorID *uuid.UUID) (*domain.LDAPSyncLog, error) {
	cfg, err := s.Repo.GetConfig(ctx, configID)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDirectoryConfigNotFound)
	}
	now := s.now()
	acquired, err := s.Repo.TryAcquireSync(ctx, cfg.ID, now, now.Add(-syncLockStaleAfter))
	if err != nil {
		return nil, err
	}
	if !acquired {
		return nil, coreerrors.ErrSyncInProgress
	}
	log := &domain.LDAPSyncLog{
		ConfigID:   cfg.ID,
		Domain:     cfg.Domain,
		Trigger:    trigger,
		Mode:       normalizeMode(mode),
		Status:     domain.SyncStatusRunning,
		StartedAt:  now,
		OperatorID: operatorID,
		Report:     datatypes.NewJSONType(domain.SyncReport{Errors: []domain.SyncItemError{}}),
	}
	if err := s.Repo.CreateLog(ctx, log); err != nil {
		_ = s.Repo.ReleaseSync(ctx, cfg.ID, domain.SyncStatusFailed, now, nil)
		return nil, err
	}
	s.publish("ldap.sync.started", map[string]any{"config_id": cfg.ID, "log_id": log.ID, "domain": cfg.Domain, "mode": log.Mode, "trigger": trigger})
	started := *log
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.runSync(cfg, log)
	}()
	return &started, nil
}

func (s *ldapService) runSync(cfg *domain.LDAPConfig, log *domain.LDAPSyncLog) {
	ctx := s.ctx
	report, err := s.executeSync(ctx, cfg, log.Mode)
	finished := s.now()
	log.FinishedAt = &finished
	log.DurationMs = finished.Sub(log.StartedAt).Milliseconds()
	log.Report = datatypes.NewJSONType(report)
	var successAt *time.Time
	switch {
	case err != nil:
		log.Status = domain.SyncStatusFailed
		log.Message = err.Error()
	case report.Failed > 0:
		log.Status = domain.SyncStatusPartial
		successAt = &log.StartedAt
	default:
		log.Status = domain.SyncStatusSuccess
		successAt = &log.StartedAt
	}
	persist := context.WithoutCancel(ctx)
	if saveErr := s.Repo.SaveLog(persist, log); saveErr != nil {
		s.Logger.Error("Persist directory sync log failed", "domain", cfg.Domain, "error", saveErr)
	}
	if relErr := s.Repo.ReleaseSync(persist, cfg.ID, log.Status, finished, successAt); relErr != nil {
		s.Logger.Error("Release directory sync lock failed", "domain", cfg.Domain, "error", relErr)
	}
	s.Logger.Info("Directory sync finished", "domain", cfg.Domain, "status", log.Status, "created", report.Created, "updated", report.Updated, "failed", report.Failed)
	s.publish("ldap.sync.finished", map[string]any{"config_id": cfg.ID, "log_id": log.ID, "domain": cfg.Domain, "status": log.Status, "report": report, "message": log.Message})
}

func (s *ldapService) executeSync(ctx context.Context, cfg *domain.LDAPConfig, mode string) (domain.SyncReport, error) {
	report := domain.SyncReport{Errors: []domain.SyncItemError{}}
	resolver := newDepartmentResolver(s.Departments)
	planned, summary, _, err := s.plan(ctx, cfg, mode, resolver)
	if err != nil {
		return report, err
	}
	report.Total = summary.Total
	fail := func(p plannedUser, reason string) {
		report.Failed++
		if len(report.Errors) < reportErrorLimit {
			report.Errors = append(report.Errors, domain.SyncItemError{Username: p.item.Username, DN: p.item.DN, Reason: reason})
		}
	}
	for _, p := range planned {
		if ctx.Err() != nil {
			return report, fmt.Errorf("同步被中断：%w", ctx.Err())
		}
		switch p.item.Action {
		case domain.SyncActionUnchanged:
			report.Unchanged++
			continue
		case domain.SyncActionSkip:
			report.Skipped++
			continue
		case domain.SyncActionConflict:
			fail(p, p.item.Reason)
			continue
		}
		if _, err := s.apply(ctx, cfg, resolver, p); err != nil {
			fail(p, err.Error())
			continue
		}
		switch p.item.Action {
		case domain.SyncActionCreate:
			report.Created++
		case domain.SyncActionUpdate:
			report.Updated++
		case domain.SyncActionDisable:
			report.Disabled++
		}
	}
	report.DepartmentsCreated = resolver.created
	return report, nil
}

func (s *ldapService) RunDueSyncs(ctx context.Context, now time.Time) int {
	configs, err := s.Repo.ListConfigs(ctx)
	if err != nil {
		s.Logger.Error("List directory configs for scheduler failed", "error", err)
		return 0
	}
	started := 0
	for _, cfg := range configs {
		if !cfg.SyncEnabled || cfg.SyncIntervalMinutes <= 0 || cfg.SyncStatus == domain.SyncStatusRunning {
			continue
		}
		if cfg.LastSyncAt != nil && now.Sub(*cfg.LastSyncAt) < time.Duration(cfg.SyncIntervalMinutes)*time.Minute {
			continue
		}
		if _, err := s.StartSync(ctx, cfg.ID, domain.SyncModeFull, domain.SyncTriggerSchedule, nil); err != nil {
			if !errors.Is(err, coreerrors.ErrSyncInProgress) {
				s.Logger.Error("Scheduled directory sync failed to start", "domain", cfg.Domain, "error", err)
			}
			continue
		}
		started++
	}
	return started
}

func (s *ldapService) ListSyncLogs(ctx context.Context, configID *uuid.UUID, page, pageSize int) ([]domain.LDAPSyncLog, int64, error) {
	return s.Repo.ListLogs(ctx, configID, page, pageSize)
}

func RunDirectoryScheduler(ctx context.Context, svc domain.LDAPService, tick time.Duration, log *slog.Logger) {
	ticker := time.NewTicker(tick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if started := svc.RunDueSyncs(ctx, now); started > 0 {
				log.Info("Scheduled directory syncs started", "count", started)
			}
		}
	}
}
