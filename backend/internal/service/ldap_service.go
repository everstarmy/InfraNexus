package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/requestmeta"
	"infranexus/internal/core/secret"
	"infranexus/internal/domain"
)

const (
	syncLeaseDuration       = 30 * time.Second
	syncHeartbeatInterval   = 10 * time.Second
	syncProgressMinInterval = 500 * time.Millisecond
	ldapSyncPlanTTL         = 10 * time.Minute
	previewItemLimit        = 500
	reportErrorLimit        = 200
)

var errSyncLeaseLost = errors.New("directory sync lease lost")

func syncErrorCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, coreerrors.ErrDirectoryUnavailable):
		return "directory_unavailable"
	case errors.Is(err, domain.ErrEditRevisionConflict):
		return "revision_conflict"
	default:
		return "sync_failed"
	}
}

type LDAPServiceDeps struct {
	Repo         domain.LDAPRepository
	Users        domain.UserRepository
	Roles        domain.RoleRepository
	Departments  domain.DepartmentRepository
	Organization domain.OrganizationUnitOfWork
	Gateway      domain.DirectoryGateway
	Cipher       *secret.Cipher
	Events       domain.EventPublisher
	Logger       *slog.Logger
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

func (s *ldapService) publish(ctx context.Context, event string, data any) {
	if s.Events != nil {
		if err := s.Events.Publish(ctx, event, data); err != nil {
			s.Logger.WarnContext(ctx, "Publish directory event failed", "event", event, "error_type", fmt.Sprintf("%T", err))
		}
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
	var updated *domain.User
	apply := func(writeCtx context.Context) error {
		var deptID *uuid.UUID
		if p.target != nil && (p.item.Action == domain.SyncActionCreate || containsChange(p.item.Changes, "department")) {
			id, err := resolver.ensure(writeCtx, p.target)
			if err != nil {
				return err
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
			if err := s.Users.Create(writeCtx, &user); err != nil {
				return err
			}
			if cfg.DefaultRoleID != nil {
				if err := s.Users.AssignRoles(writeCtx, user.ID, []uuid.UUID{*cfg.DefaultRoleID}); err != nil {
					return err
				}
			}
			var err error
			updated, err = s.Users.GetByID(writeCtx, user.ID)
			return err
		case domain.SyncActionUpdate, domain.SyncActionDisable:
			values := make(map[string]any, len(p.values)+1)
			for k, v := range p.values {
				values[k] = v
			}
			if containsChange(p.item.Changes, "department") {
				values["department_id"] = deptID
			}
			if len(values) > 0 {
				if err := s.Users.UpdateColumnsCAS(writeCtx, p.local.ID, p.local.EditRevision, values); err != nil {
					return err
				}
			}
			var err error
			updated, err = s.Users.GetByID(writeCtx, p.local.ID)
			return err
		default:
			updated = p.local
			return nil
		}
	}

	departmentWrite := (p.item.Action == domain.SyncActionCreate && p.target != nil) || containsChange(p.item.Changes, "department")
	if departmentWrite && s.Organization != nil {
		_, err := s.Organization.Write(ctx, nil, apply)
		if err != nil {
			return nil, err
		}
		return updated, nil
	}
	if err := apply(ctx); err != nil {
		return nil, err
	}
	return updated, nil
}

func containsChange(changes []string, change string) bool {
	for _, c := range changes {
		if c == change {
			return true
		}
	}
	return false
}

type syncLocalRevision struct {
	ID           uuid.UUID  `json:"id"`
	EditRevision int64      `json:"edit_revision"`
	Username     string     `json:"username"`
	ExternalID   string     `json:"external_id"`
	Email        string     `json:"email"`
	Nickname     string     `json:"nickname"`
	Status       int        `json:"status"`
	DepartmentID *uuid.UUID `json:"department_id"`
}

func syncPlanFingerprint(cfg *domain.LDAPConfig, mode string, directory []domain.DirectoryUser, locals []domain.User, planned []plannedUser) (string, error) {
	directory = append([]domain.DirectoryUser(nil), directory...)
	sort.Slice(directory, func(i, j int) bool {
		if directory[i].DN != directory[j].DN {
			return directory[i].DN < directory[j].DN
		}
		if directory[i].ExternalID != directory[j].ExternalID {
			return directory[i].ExternalID < directory[j].ExternalID
		}
		return directory[i].Username < directory[j].Username
	})
	localRevisions := make([]syncLocalRevision, 0, len(locals))
	for _, user := range locals {
		localRevisions = append(localRevisions, syncLocalRevision{
			ID: user.ID, EditRevision: user.EditRevision, Username: user.Username,
			ExternalID: user.ExternalID, Email: user.Email, Nickname: user.Nickname,
			Status: user.Status, DepartmentID: user.DepartmentID,
		})
	}
	sort.Slice(localRevisions, func(i, j int) bool { return localRevisions[i].ID.String() < localRevisions[j].ID.String() })
	items := make([]domain.SyncPlanItem, 0, len(planned))
	for _, p := range planned {
		items = append(items, p.item)
	}
	payload := struct {
		Mode           string                 `json:"mode"`
		ConfigRevision time.Time              `json:"config_revision"`
		Directory      []domain.DirectoryUser `json:"directory"`
		Locals         []syncLocalRevision    `json:"locals"`
		Items          []domain.SyncPlanItem  `json:"items"`
	}{mode, cfg.UpdatedAt, directory, localRevisions, items}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func (s *ldapService) plan(ctx context.Context, cfg *domain.LDAPConfig, mode string, resolver departmentLookup) ([]plannedUser, domain.SyncSummary, []string, string, error) {
	bindPassword, err := s.bindPassword(cfg)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, "", err
	}
	var since *time.Time
	if mode == domain.SyncModeIncremental {
		since = cfg.LastSuccessAt
	}
	directory, err := s.Gateway.SearchUsers(ctx, cfg, bindPassword, since)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, "", directoryFailure(s.Logger, cfg, err)
	}
	locals, err := s.Users.ListByDomain(ctx, cfg.Domain)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, "", err
	}
	owners, err := s.Users.EmailOwners(ctx)
	if err != nil {
		return nil, domain.SyncSummary{}, nil, "", err
	}
	planned, summary, departments, err := buildSyncPlan(ctx, syncInputs{cfg: cfg, mode: mode, directory: directory, locals: locals, emailOwners: owners, departments: resolver})
	if err != nil {
		return nil, summary, nil, "", err
	}
	fingerprint, err := syncPlanFingerprint(cfg, mode, directory, locals, planned)
	return planned, summary, departments, fingerprint, err
}

func normalizeMode(mode string) string {
	if mode == domain.SyncModeIncremental {
		return mode
	}
	return domain.SyncModeFull
}

func syncLogStartResponse(log *domain.LDAPSyncLog) *domain.LDAPSyncLog {
	copy := *log
	report := log.Report.Data()
	report.Errors = nil
	copy.Report = datatypes.NewJSONType(report)
	if copy.Status == domain.SyncStatusFailed && copy.Message != "" {
		copy.Message = "同步失败，请通过授权的任务详情接口查看诊断"
	}
	return &copy
}

func (s *ldapService) Preview(ctx context.Context, configID uuid.UUID, mode string, operatorID *uuid.UUID) (*domain.SyncPlan, error) {
	cfg, err := s.Repo.GetConfig(ctx, configID)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDirectoryConfigNotFound)
	}
	mode = normalizeMode(mode)
	planned, summary, toCreate, fingerprint, err := s.plan(ctx, cfg, mode, newDepartmentResolver(s.Departments))
	if err != nil {
		return nil, err
	}
	now := s.now()
	if _, err := s.Repo.DeleteExpiredPlans(ctx, now); err != nil {
		s.Logger.WarnContext(ctx, "Delete expired LDAP plans failed", "error", err)
	}
	items := make([]domain.SyncPlanItem, 0, len(planned))
	for _, item := range planned {
		items = append(items, item.item)
	}
	plan := &domain.LDAPSyncPlanSnapshot{
		BaseEntity: domain.BaseEntity{ID: uuid.New()},
		ConfigID:   cfg.ID, OperatorID: operatorID, Mode: mode,
		ConfigRevision: cfg.UpdatedAt, Fingerprint: fingerprint, ExpiresAt: now.Add(ldapSyncPlanTTL),
		Summary: datatypes.NewJSONType(summary), Items: datatypes.NewJSONType(items),
		DepartmentsToCreate: datatypes.NewJSONType(toCreate),
	}
	if err := s.Repo.CreatePlan(ctx, plan); err != nil {
		return nil, err
	}
	return &domain.SyncPlan{
		PlanID: plan.ID, ConfigID: cfg.ID, Domain: cfg.Domain, Mode: mode,
		GeneratedAt: now, ExpiresAt: plan.ExpiresAt, ConfigRevision: cfg.UpdatedAt,
		Summary: summary, DepartmentsToCreate: toCreate, Items: []domain.SyncPlanItem{},
		Truncated: len(items) > 0,
	}, nil
}

func (s *ldapService) ListSyncPlanItems(ctx context.Context, planID uuid.UUID, operatorID *uuid.UUID, page, pageSize int) ([]domain.SyncPlanItem, int64, error) {
	plan, err := s.Repo.GetPlan(ctx, planID)
	if err != nil {
		return nil, 0, notFoundAs(err, coreerrors.ErrDirectorySyncNotFound)
	}
	if operatorID == nil || plan.OperatorID == nil || *operatorID != *plan.OperatorID {
		return nil, 0, coreerrors.ErrPermissionDenied
	}
	if !plan.ExpiresAt.After(s.now()) {
		return nil, 0, coreerrors.ErrResourceConflict.WithMessage("预览计划已过期，请重新生成预览")
	}
	items, total, err := s.Repo.ListPlanItems(ctx, planID, page, pageSize)
	return items, total, err
}

func (s *ldapService) StartSync(ctx context.Context, req domain.LDAPSyncRequest, trigger string, operatorID *uuid.UUID) (*domain.LDAPSyncLog, error) {
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.PlanID == uuid.Nil {
		return nil, coreerrors.ErrParamInvalid.WithMessage("请先生成并确认有效的同步预览")
	}
	if trigger == domain.SyncTriggerManual && (operatorID == nil || len(req.IdempotencyKey) < 16 || len(req.IdempotencyKey) > 128) {
		return nil, coreerrors.ErrParamInvalid.WithMessage("同步请求需要有效的幂等请求 ID")
	}
	if operatorID != nil && req.IdempotencyKey != "" {
		previous, err := s.Repo.GetLogByIdempotency(ctx, req.ConfigID, *operatorID, req.IdempotencyKey)
		if err == nil {
			if previous.PlanID != req.PlanID {
				return nil, coreerrors.ErrResourceConflict.WithMessage("幂等请求 ID 已用于其他同步计划")
			}
			return syncLogStartResponse(previous), nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	plan, err := s.Repo.GetPlan(ctx, req.PlanID)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDirectorySyncNotFound)
	}
	if plan.ConfigID != req.ConfigID || (req.Mode != "" && normalizeMode(req.Mode) != plan.Mode) {
		return nil, coreerrors.ErrResourceConflict.WithMessage("同步请求与已确认的预览计划不匹配")
	}
	if (operatorID == nil) != (plan.OperatorID == nil) || (operatorID != nil && *operatorID != *plan.OperatorID) {
		return nil, coreerrors.ErrPermissionDenied
	}
	if !plan.ExpiresAt.After(s.now()) {
		return nil, coreerrors.ErrResourceConflict.WithMessage("预览计划已过期，请重新生成预览")
	}
	cfg, err := s.Repo.GetConfig(ctx, plan.ConfigID)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDirectoryConfigNotFound)
	}
	if !cfg.UpdatedAt.Equal(plan.ConfigRevision) {
		return nil, coreerrors.ErrResourceConflict.WithMessage("目录配置在预览后已变化，请重新生成预览")
	}
	mode := plan.Mode
	planned, summary, _, fingerprint, err := s.plan(ctx, cfg, mode, newDepartmentResolver(s.Departments))
	if err != nil {
		return nil, err
	}
	if fingerprint != plan.Fingerprint {
		return nil, coreerrors.ErrResourceConflict.WithMessage("目录或本地资料在预览后已变化，请重新生成预览")
	}
	now := s.now()
	taskID := uuid.New()
	total := len(planned)
	log := &domain.LDAPSyncLog{
		BaseEntity: domain.BaseEntity{ID: taskID},
		ConfigID:   cfg.ID,
		Domain:     cfg.Domain,
		Trigger:    trigger,
		Mode:       normalizeMode(mode),
		Status:     domain.SyncStatusRunning,
		StartedAt:  now,
		OperatorID: operatorID,
		RequestID:  requestmeta.RequestID(ctx),
		PlanID:     plan.ID, IdempotencyKey: req.IdempotencyKey,
		Phase: domain.SyncPhasePreparing, Processed: 0,
		Report: datatypes.NewJSONType(domain.SyncReport{Errors: []domain.SyncItemError{}}),
	}
	if trigger == domain.SyncTriggerSchedule {
		log.IdempotencyKey = ""
	}
	acquired, err := s.Repo.CreateSyncTask(ctx, cfg.ID, plan.ConfigRevision, now, now.Add(syncLeaseDuration), log)
	if err != nil {
		return nil, err
	}
	if !acquired {
		if operatorID != nil && req.IdempotencyKey != "" {
			previous, findErr := s.Repo.GetLogByIdempotency(ctx, req.ConfigID, *operatorID, req.IdempotencyKey)
			if findErr == nil {
				if previous.PlanID != req.PlanID {
					return nil, coreerrors.ErrResourceConflict.WithMessage("幂等请求 ID 已用于其他同步计划")
				}
				return syncLogStartResponse(previous), nil
			}
			if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return nil, findErr
			}
		}
		latest, getErr := s.Repo.GetConfig(ctx, cfg.ID)
		if getErr == nil && !latest.UpdatedAt.Equal(plan.ConfigRevision) {
			return nil, coreerrors.ErrResourceConflict.WithMessage("目录配置在预览后已变化，请重新生成预览")
		}
		return nil, coreerrors.ErrSyncInProgress
	}
	log.Total = nil
	s.publish(ctx, "ldap.sync.started", map[string]any{
		"schema_version": 1, "event_id": uuid.NewString(), "task_id": log.ID, "phase": domain.SyncPhasePreparing,
		"mode": log.Mode, "trigger": trigger, "timestamp": now,
	})
	started := *log
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.runSync(cfg, log, planned, summary, total)
	}()
	return &started, nil
}

func (s *ldapService) GetSyncLog(ctx context.Context, id uuid.UUID) (*domain.LDAPSyncLog, error) {
	log, err := s.Repo.GetLog(ctx, id)
	return log, notFoundAs(err, coreerrors.ErrDirectorySyncNotFound)
}

func (s *ldapService) runSync(cfg *domain.LDAPConfig, log *domain.LDAPSyncLog, planned []plannedUser, summary domain.SyncSummary, total int) {
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(syncHeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				leaseCtx, leaseCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
				leaseNow := s.now()
				owned, err := s.Repo.RenewSyncLease(leaseCtx, cfg.ID, log.ID, leaseNow, leaseNow.Add(syncLeaseDuration))
				leaseCancel()
				if err != nil {
					s.Logger.WarnContext(ctx, "Renew LDAP sync lease failed", "task_id", log.ID, "error", err)
					continue
				}
				if !owned {
					cancel()
					return
				}
			}
		}
	}()
	defer func() {
		cancel()
		<-heartbeatDone
	}()

	report := domain.SyncReport{Total: summary.Total, Errors: []domain.SyncItemError{}}
	resolver := newDepartmentResolver(s.Departments)
	lastPersist := time.Time{}
	persistProgress := func(phase string, processed int, force bool) error {
		now := s.now()
		if !force && !lastPersist.IsZero() && now.Sub(lastPersist) < syncProgressMinInterval {
			return nil
		}
		log.Phase = phase
		log.Processed = processed
		log.Total = &total
		log.Report = datatypes.NewJSONType(report)
		persistCtx, persistCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		owned, err := s.Repo.SaveLogIfOwner(persistCtx, log, now)
		persistCancel()
		if err != nil {
			return err
		}
		if !owned {
			return errSyncLeaseLost
		}
		lastPersist = now
		s.publish(ctx, "ldap.sync.progress", map[string]any{
			"schema_version": 1, "event_id": uuid.NewString(), "task_id": log.ID,
			"phase": phase, "processed": processed, "total": &total, "timestamp": now,
			"created": report.Created, "updated": report.Updated, "unchanged": report.Unchanged,
			"disabled": report.Disabled, "skipped": report.Skipped, "failed": report.Failed,
		})
		return nil
	}

	if err := persistProgress(domain.SyncPhaseApplying, 0, true); err != nil {
		s.Logger.WarnContext(ctx, "LDAP sync lost task lease before apply", "task_id", log.ID)
		return
	}
	processed := 0
	progressInterval := len(planned) / 20
	if progressInterval < 1 {
		progressInterval = 1
	}
	fail := func(p plannedUser, reason string) {
		report.Failed++
		if len(report.Errors) < reportErrorLimit {
			report.Errors = append(report.Errors, domain.SyncItemError{Username: p.item.Username, DN: p.item.DN, Reason: reason})
		} else {
			report.ErrorsTruncated = true
		}
	}
	var runErr error
	for _, p := range planned {
		if ctx.Err() != nil {
			runErr = fmt.Errorf("同步被中断：%w", ctx.Err())
			break
		}
		switch p.item.Action {
		case domain.SyncActionUnchanged:
			report.Unchanged++
		case domain.SyncActionSkip:
			report.Skipped++
		case domain.SyncActionConflict:
			fail(p, p.item.Reason)
		default:
			leaseNow := s.now()
			owned, err := s.Repo.RenewSyncLease(ctx, cfg.ID, log.ID, leaseNow, leaseNow.Add(syncLeaseDuration))
			if err != nil {
				runErr = err
				break
			}
			if !owned {
				runErr = errSyncLeaseLost
				break
			}
			if _, err := s.apply(ctx, cfg, resolver, p); err != nil {
				reason := err.Error()
				if errors.Is(err, domain.ErrEditRevisionConflict) {
					reason = "本地资料在同步过程中被修改，未覆盖该记录"
				}
				fail(p, reason)
			} else {
				switch p.item.Action {
				case domain.SyncActionCreate:
					report.Created++
				case domain.SyncActionUpdate:
					report.Updated++
				case domain.SyncActionDisable:
					report.Disabled++
				}
			}
		}
		if runErr != nil {
			break
		}
		processed++
		if processed%progressInterval == 0 || processed == len(planned) {
			if err := persistProgress(domain.SyncPhaseApplying, processed, false); err != nil {
				runErr = err
				break
			}
		}
	}
	if errors.Is(runErr, errSyncLeaseLost) {
		s.Logger.WarnContext(ctx, "LDAP sync stopped after losing task lease", "task_id", log.ID)
		return
	}
	report.DepartmentsCreated = resolver.created
	finished := s.now()
	log.FinishedAt = &finished
	log.DurationMs = finished.Sub(log.StartedAt).Milliseconds()
	log.Report = datatypes.NewJSONType(report)
	var successAt *time.Time
	switch {
	case runErr != nil:
		log.Status = domain.SyncStatusFailed
		log.Message = runErr.Error()
	case report.Failed > 0:
		log.Status = domain.SyncStatusPartial
		successAt = &log.StartedAt
	default:
		log.Status = domain.SyncStatusSuccess
		successAt = &log.StartedAt
	}
	log.Phase = domain.SyncPhaseFinalizing
	persistCtx, persistCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	owned, saveErr := s.Repo.SaveLogIfOwner(persistCtx, log, finished)
	released := false
	if saveErr == nil && owned {
		released, saveErr = s.Repo.ReleaseSync(persistCtx, cfg.ID, log.ID, log.Status, finished, successAt)
	}
	persistCancel()
	if saveErr != nil || !owned || !released {
		s.Logger.Error("Persist LDAP sync terminal state failed", "task_id", log.ID, "operator_id", log.OperatorID, "request_id", log.RequestID, "error", saveErr)
		return
	}
	s.Logger.Info("Directory sync finished", "task_id", log.ID, "operator_id", log.OperatorID, "request_id", log.RequestID, "domain", cfg.Domain, "status", log.Status, "created", report.Created, "updated", report.Updated, "failed", report.Failed)
	s.publish(ctx, "ldap.sync.progress", map[string]any{
		"schema_version": 1, "event_id": uuid.NewString(), "task_id": log.ID,
		"phase": domain.SyncPhaseFinalizing, "processed": processed, "total": &total,
		"timestamp": finished, "created": report.Created, "updated": report.Updated,
		"unchanged": report.Unchanged, "disabled": report.Disabled, "skipped": report.Skipped,
		"failed": report.Failed, "error_code": syncErrorCode(runErr),
	})
	s.publish(ctx, "ldap.sync.finished", map[string]any{
		"schema_version": 1, "event_id": uuid.NewString(), "task_id": log.ID,
		"phase": domain.SyncPhaseFinalizing, "status": log.Status, "timestamp": finished,
		"created": report.Created, "updated": report.Updated, "unchanged": report.Unchanged,
		"disabled": report.Disabled, "skipped": report.Skipped, "failed": report.Failed,
		"error_code": syncErrorCode(runErr), "message_code": "sync_result_available",
	})
}

func (s *ldapService) RunDueSyncs(ctx context.Context, now time.Time) int {
	actualNow := s.now()
	if err := s.Repo.RecoverExpiredSyncs(ctx, actualNow); err != nil {
		s.Logger.Error("Recover expired directory sync tasks failed", "error", err)
	}
	if _, err := s.Repo.DeleteExpiredPlans(ctx, actualNow); err != nil {
		s.Logger.Error("Delete expired directory sync plans failed", "error", err)
	}
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
		plan, err := s.Preview(ctx, cfg.ID, domain.SyncModeFull, nil)
		if err != nil {
			s.Logger.Error("Scheduled directory sync preview failed", "domain", cfg.Domain, "error", err)
			continue
		}
		req := domain.LDAPSyncRequest{ConfigID: cfg.ID, Mode: plan.Mode, PlanID: plan.PlanID, IdempotencyKey: uuid.NewString()}
		if _, err := s.StartSync(ctx, req, domain.SyncTriggerSchedule, nil); err != nil {
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
	if err := s.Repo.RecoverExpiredSyncs(ctx, s.now()); err != nil {
		s.Logger.WarnContext(ctx, "Recover expired directory sync tasks while listing failed", "error", err)
	}
	logs, total, err := s.Repo.ListLogs(ctx, configID, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	for i := range logs {
		report := logs[i].Report.Data()
		report.Errors = nil
		logs[i].Report = datatypes.NewJSONType(report)
		if logs[i].Status == domain.SyncStatusFailed && logs[i].Message != "" {
			logs[i].Message = "同步失败，请打开任务详情查看诊断"
		}
	}
	return logs, total, nil
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
