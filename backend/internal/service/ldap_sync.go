package service

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/go-ldap/ldap/v3"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type ouLevel struct {
	Name string
	DN   string
}

type deptSegment struct {
	Name       string
	ExternalID string
}

type deptTarget struct {
	BaseID   *uuid.UUID
	Segments []deptSegment
}

func (t *deptTarget) baseOrNil() *uuid.UUID {
	if t == nil {
		return nil
	}
	return t.BaseID
}

func normalizeRDNs(rdns []*ldap.RelativeDN) string {
	parts := make([]string, 0, len(rdns))
	for _, rdn := range rdns {
		attrs := make([]string, 0, len(rdn.Attributes))
		for _, a := range rdn.Attributes {
			attrs = append(attrs, strings.ToLower(strings.TrimSpace(a.Type))+"="+strings.ToLower(strings.TrimSpace(a.Value)))
		}
		parts = append(parts, strings.Join(attrs, "+"))
	}
	return strings.Join(parts, ",")
}

func NormalizeDN(dn string) (string, error) {
	parsed, err := ldap.ParseDN(dn)
	if err != nil {
		return "", err
	}
	return normalizeRDNs(parsed.RDNs), nil
}

func ouChain(userDN, baseDN string) []ouLevel {
	dn, err := ldap.ParseDN(userDN)
	if err != nil || len(dn.RDNs) < 2 {
		return nil
	}
	base, err := ldap.ParseDN(baseDN)
	if err != nil {
		return nil
	}
	parents := dn.RDNs[1:]
	if len(parents) < len(base.RDNs) || normalizeRDNs(parents[len(parents)-len(base.RDNs):]) != normalizeRDNs(base.RDNs) {
		return nil
	}
	inner := len(parents) - len(base.RDNs)
	levels := make([]ouLevel, 0, inner)
	for i := inner - 1; i >= 0; i-- {
		rdn := parents[i]
		if len(rdn.Attributes) != 1 || !strings.EqualFold(rdn.Attributes[0].Type, "OU") {
			continue
		}
		levels = append(levels, ouLevel{Name: strings.TrimSpace(rdn.Attributes[0].Value), DN: normalizeRDNs(parents[i:])})
	}
	return levels
}

func departmentTarget(cfg *domain.LDAPConfig, du domain.DirectoryUser) *deptTarget {
	opts := cfg.DepartmentSync.Data()
	switch opts.Strategy {
	case domain.DeptStrategyAttribute:
		value := strings.TrimSpace(du.Department)
		if value == "" {
			return nil
		}
		return &deptTarget{BaseID: opts.RootDepartmentID, Segments: []deptSegment{{Name: value, ExternalID: "attr:" + cfg.Domain + ":" + strings.ToLower(value)}}}
	case domain.DeptStrategyOU:
		levels := ouChain(du.DN, cfg.BaseDN)
		base := opts.RootDepartmentID
		start := 0
		for i := len(levels) - 1; i >= 0; i-- {
			if id, ok := mappedDepartment(opts.OUMappings, levels[i].DN); ok {
				base, start = &id, i+1
				break
			}
		}
		segments := make([]deptSegment, 0, len(levels)-start)
		for _, level := range levels[start:] {
			segments = append(segments, deptSegment{Name: level.Name, ExternalID: level.DN})
		}
		if base == nil && len(segments) == 0 {
			return nil
		}
		return &deptTarget{BaseID: base, Segments: segments}
	}
	return nil
}

func mappedDepartment(mappings []domain.OUMapping, levelDN string) (uuid.UUID, bool) {
	for _, m := range mappings {
		if normalized, err := NormalizeDN(m.OUDN); err == nil && normalized == levelDN {
			return m.DepartmentID, true
		}
	}
	return uuid.Nil, false
}

type departmentLookup interface {
	lookup(ctx context.Context, t *deptTarget) (*uuid.UUID, string, []string, error)
}

type syncInputs struct {
	cfg         *domain.LDAPConfig
	mode        string
	directory   []domain.DirectoryUser
	locals      []domain.User
	emailOwners map[string]uuid.UUID
	departments departmentLookup
}

type plannedUser struct {
	item   domain.SyncPlanItem
	dir    domain.DirectoryUser
	local  *domain.User
	target *deptTarget
	values map[string]any
}

func buildSyncPlan(ctx context.Context, in syncInputs) ([]plannedUser, domain.SyncSummary, []string, error) {
	byExternal := make(map[string]*domain.User)
	byName := make(map[string]*domain.User)
	for i := range in.locals {
		u := &in.locals[i]
		if u.ExternalID != "" {
			byExternal[u.ExternalID] = u
		}
		byName[strings.ToLower(u.Username)] = u
	}
	owners := make(map[string]uuid.UUID, len(in.emailOwners))
	for email, id := range in.emailOwners {
		owners[strings.ToLower(email)] = id
	}
	summary := domain.SyncSummary{Total: len(in.directory)}
	toCreate := make([]string, 0)
	seenCreate := make(map[string]bool)
	seenNames := make(map[string]bool)
	matched := make(map[uuid.UUID]bool)
	planned := make([]plannedUser, 0, len(in.directory))

	for _, du := range in.directory {
		username := strings.ToLower(strings.TrimSpace(du.Username))
		p := plannedUser{dir: du, item: domain.SyncPlanItem{Username: username, Nickname: du.Nickname, Email: du.Email, DN: du.DN}}
		switch {
		case username == "":
			p.item.Action, p.item.Reason = domain.SyncActionSkip, "目录条目缺少用户名属性"
		case seenNames[username]:
			p.item.Action, p.item.Reason = domain.SyncActionConflict, "目录中存在重复的用户名"
		}
		if p.item.Action != "" {
			planned = append(planned, p)
			continue
		}
		seenNames[username] = true

		local := byExternal[du.ExternalID]
		if du.ExternalID == "" || local == nil {
			local = byName[username]
			if local != nil && local.ExternalID != "" && du.ExternalID != "" && local.ExternalID != du.ExternalID {
				p.item.Action, p.item.Reason = domain.SyncActionConflict, "同名本地档案已绑定其他目录对象"
				planned = append(planned, p)
				continue
			}
		}
		p.local = local
		p.target = departmentTarget(in.cfg, du)
		var deptID *uuid.UUID
		if p.target != nil {
			id, display, missing, err := in.departments.lookup(ctx, p.target)
			if err != nil {
				return nil, summary, nil, err
			}
			deptID, p.item.Department = id, display
			if len(missing) > 0 && !(local == nil && du.Disabled) {
				for _, name := range missing {
					if !seenCreate[name] {
						seenCreate[name] = true
						toCreate = append(toCreate, name)
					}
				}
			}
		}
		email := strings.TrimSpace(du.Email)
		emailFree := func(owner uuid.UUID) bool {
			current, taken := owners[strings.ToLower(email)]
			return !taken || current == owner
		}

		if local == nil {
			if du.Disabled {
				p.item.Action, p.item.Reason = domain.SyncActionSkip, "目录账号已禁用，未创建本地档案"
				planned = append(planned, p)
				continue
			}
			p.item.Action = domain.SyncActionCreate
			p.values = map[string]any{"email": ""}
			if email != "" {
				if emailFree(uuid.Nil) {
					p.values["email"] = email
					owners[strings.ToLower(email)] = uuid.New()
				} else {
					p.item.Reason = "邮箱已被其他账号占用，已忽略"
				}
			}
			planned = append(planned, p)
			continue
		}

		matched[local.ID] = true
		p.item.UserID = &local.ID
		p.values = map[string]any{}
		changes := make([]string, 0)
		if local.Username != username {
			if other := byName[username]; other != nil && other.ID != local.ID {
				p.item.Action, p.item.Reason = domain.SyncActionConflict, "新用户名已被其他本地档案占用"
				planned = append(planned, p)
				continue
			}
			p.values["username"] = username
			changes = append(changes, "username")
		}
		if du.Nickname != "" && du.Nickname != local.Nickname {
			p.values["nickname"] = du.Nickname
			changes = append(changes, "nickname")
		}
		if email != "" && !strings.EqualFold(email, local.Email) {
			if emailFree(local.ID) {
				p.values["email"] = email
				owners[strings.ToLower(email)] = local.ID
				changes = append(changes, "email")
			} else {
				p.item.Reason = "邮箱已被其他账号占用，已忽略"
			}
		}
		if local.ExternalID == "" && du.ExternalID != "" {
			p.values["external_id"] = du.ExternalID
			changes = append(changes, "external_id")
		}
		if p.target != nil && (deptID == nil || local.DepartmentID == nil || *local.DepartmentID != *deptID) {
			changes = append(changes, "department")
		}
		if du.Disabled && local.Status == domain.StatusEnabled {
			p.values["status"] = domain.StatusDisabled
			changes = append(changes, "status")
		}
		p.item.Changes = changes
		p.item.Action = domain.SyncActionUnchanged
		if len(changes) > 0 {
			p.item.Action = domain.SyncActionUpdate
		}
		planned = append(planned, p)
	}

	if in.mode == domain.SyncModeFull && in.cfg.DisableMissingUsers {
		for i := range in.locals {
			u := &in.locals[i]
			if matched[u.ID] || u.Status != domain.StatusEnabled {
				continue
			}
			planned = append(planned, plannedUser{
				local:  u,
				values: map[string]any{"status": domain.StatusDisabled},
				item: domain.SyncPlanItem{
					Action: domain.SyncActionDisable, Username: u.Username, Nickname: u.Nickname, Email: u.Email,
					UserID: &u.ID, Changes: []string{"status"}, Reason: "目录中已不存在该账号",
				},
			})
		}
	}

	for _, p := range planned {
		switch p.item.Action {
		case domain.SyncActionCreate:
			summary.Create++
		case domain.SyncActionUpdate:
			summary.Update++
		case domain.SyncActionUnchanged:
			summary.Unchanged++
		case domain.SyncActionDisable:
			summary.Disable++
		case domain.SyncActionSkip:
			summary.Skip++
		case domain.SyncActionConflict:
			summary.Conflict++
		}
	}
	summary.DepartmentsToCreate = len(toCreate)
	return planned, summary, toCreate, nil
}

type departmentResolver struct {
	repo    domain.DepartmentRepository
	cache   map[string]uuid.UUID
	created int
}

func newDepartmentResolver(repo domain.DepartmentRepository) *departmentResolver {
	return &departmentResolver{repo: repo, cache: make(map[string]uuid.UUID)}
}

func (r *departmentResolver) base(ctx context.Context, t *deptTarget) (*domain.Department, error) {
	if t.BaseID == nil {
		return nil, nil
	}
	dept, err := r.repo.GetByID(ctx, *t.BaseID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return dept, err
}

func (r *departmentResolver) find(ctx context.Context, parent *uuid.UUID, seg deptSegment) (*uuid.UUID, error) {
	if id, ok := r.cache[seg.ExternalID]; ok {
		return &id, nil
	}
	dept, err := r.repo.GetByExternalID(ctx, domain.SourceLDAP, seg.ExternalID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		dept, err = r.repo.FindChildByName(ctx, parent, seg.Name)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.cache[seg.ExternalID] = dept.ID
	return &dept.ID, nil
}

func targetDisplay(base *domain.Department, segments []deptSegment) string {
	names := make([]string, 0, len(segments)+1)
	if base != nil {
		names = append(names, base.Name)
	}
	for _, s := range segments {
		names = append(names, s.Name)
	}
	return strings.Join(names, " / ")
}

func (r *departmentResolver) lookup(ctx context.Context, t *deptTarget) (*uuid.UUID, string, []string, error) {
	base, err := r.base(ctx, t)
	if err != nil {
		return nil, "", nil, err
	}
	display := targetDisplay(base, t.Segments)
	var parent *uuid.UUID
	if base != nil {
		parent = &base.ID
	}
	for i, seg := range t.Segments {
		id, err := r.find(ctx, parent, seg)
		if err != nil {
			return nil, "", nil, err
		}
		if id == nil {
			missing := make([]string, 0, len(t.Segments)-i)
			for _, rest := range t.Segments[i:] {
				missing = append(missing, rest.Name)
			}
			return nil, display, missing, nil
		}
		parent = id
	}
	return parent, display, nil, nil
}

func ldapDepartmentCode(externalID string) string {
	sum := sha1.Sum([]byte(externalID))
	return "ldap-" + hex.EncodeToString(sum[:])[:12]
}

func (r *departmentResolver) ensure(ctx context.Context, t *deptTarget) (*uuid.UUID, error) {
	base, err := r.base(ctx, t)
	if err != nil {
		return nil, err
	}
	var parent *uuid.UUID
	parentPath := domain.DepartmentRootPath
	if base != nil {
		parent, parentPath = &base.ID, base.TreePath
	}
	for _, seg := range t.Segments {
		id, err := r.find(ctx, parent, seg)
		if err != nil {
			return nil, err
		}
		if id != nil {
			dept, err := r.repo.GetByID(ctx, *id)
			if err != nil {
				return nil, err
			}
			parent, parentPath = &dept.ID, dept.TreePath
			continue
		}
		if domain.DepartmentDepth(parentPath)+1 > domain.MaxDepartmentDepth {
			return nil, errors.New("部门层级超过上限")
		}
		dept := domain.Department{
			ParentID:   parent,
			Name:       seg.Name,
			Code:       ldapDepartmentCode(seg.ExternalID),
			Status:     domain.StatusEnabled,
			Source:     domain.SourceLDAP,
			ExternalID: seg.ExternalID,
		}
		dept.ID = uuid.New()
		dept.TreePath = domain.DepartmentPath(parentPath, dept.ID)
		if err := r.repo.Create(ctx, &dept); err != nil {
			return nil, err
		}
		r.created++
		r.cache[seg.ExternalID] = dept.ID
		parent, parentPath = &dept.ID, dept.TreePath
	}
	return parent, nil
}
