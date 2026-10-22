package repository

import (
	"fmt"
	"sort"

	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type policyKey struct {
	ptype   string
	subject string
	object  string
	action  string
	v3      string
	v4      string
	v5      string
}

func rulesForRole(role domain.Role) []gormadapter.CasbinRule {
	if role.Status != domain.StatusEnabled {
		return nil
	}
	seen := make(map[policyKey]struct{}, len(role.Permissions))
	rules := make([]gormadapter.CasbinRule, 0, len(role.Permissions))
	for _, permission := range role.Permissions {
		if permission.Type != domain.PermTypeAPI || permission.Path == "" || permission.Method == "" {
			continue
		}
		key := policyKey{ptype: "p", subject: role.Code, object: permission.Path, action: permission.Method}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		rules = append(rules, gormadapter.CasbinRule{Ptype: "p", V0: key.subject, V1: key.object, V2: key.action})
	}
	sortPolicyRules(rules)
	return rules
}

func sortPolicyRules(rules []gormadapter.CasbinRule) {
	sort.Slice(rules, func(i, j int) bool {
		if rules[i].V0 != rules[j].V0 {
			return rules[i].V0 < rules[j].V0
		}
		if rules[i].V1 != rules[j].V1 {
			return rules[i].V1 < rules[j].V1
		}
		return rules[i].V2 < rules[j].V2
	})
}

func policyMultiset(rules []gormadapter.CasbinRule) map[policyKey]int {
	counts := make(map[policyKey]int, len(rules))
	for _, rule := range rules {
		counts[policyKey{ptype: rule.Ptype, subject: rule.V0, object: rule.V1, action: rule.V2, v3: rule.V3, v4: rule.V4, v5: rule.V5}]++
	}
	return counts
}

func samePolicyRules(current, desired []gormadapter.CasbinRule) bool {
	if len(current) != len(desired) {
		return false
	}
	have, want := policyMultiset(current), policyMultiset(desired)
	if len(have) != len(want) {
		return false
	}
	for key, count := range want {
		if have[key] != count {
			return false
		}
	}
	return true
}

func replaceRolePolicy(tx *gorm.DB, role domain.Role) (bool, error) {
	var current []gormadapter.CasbinRule
	if err := tx.Where("ptype = ? AND v0 = ?", "p", role.Code).Find(&current).Error; err != nil {
		return false, err
	}
	desired := rulesForRole(role)
	if samePolicyRules(current, desired) {
		return false, nil
	}
	if err := tx.Where("ptype = ? AND v0 = ?", "p", role.Code).Delete(&gormadapter.CasbinRule{}).Error; err != nil {
		return false, err
	}
	if len(desired) > 0 {
		if err := tx.Create(&desired).Error; err != nil {
			return false, err
		}
	}
	return true, nil
}

func replaceAllPolicyRules(tx *gorm.DB, desired []gormadapter.CasbinRule) (added, removed int, changed bool, err error) {
	var current []gormadapter.CasbinRule
	if err = tx.Where("ptype = ?", "p").Find(&current).Error; err != nil {
		return 0, 0, false, err
	}
	haveCounts, wantCounts := policyMultiset(current), policyMultiset(desired)
	for key, count := range wantCounts {
		if count > haveCounts[key] {
			added += count - haveCounts[key]
		}
	}
	for key, count := range haveCounts {
		if count > wantCounts[key] {
			removed += count - wantCounts[key]
		}
	}
	if added == 0 && removed == 0 {
		return 0, 0, false, nil
	}
	if err = tx.Where("ptype = ?", "p").Delete(&gormadapter.CasbinRule{}).Error; err != nil {
		return 0, 0, false, err
	}
	sortPolicyRules(desired)
	if len(desired) > 0 {
		if err = tx.Create(&desired).Error; err != nil {
			return 0, 0, false, err
		}
	}
	return added, removed, true, nil
}

func appendAuthorizationOutbox(tx *gorm.DB, event string) error {
	result := tx.Model(&domain.AuthorizationState{}).
		Where("id = ?", domain.AuthorizationStateID).
		Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": tx.NowFunc()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("authorization revision singleton is missing")
	}
	var state domain.AuthorizationState
	if err := tx.First(&state, "id = ?", domain.AuthorizationStateID).Error; err != nil {
		return err
	}
	outbox := domain.AuthorizationOutbox{
		BaseEntity:    domain.BaseEntity{ID: uuid.New(), CreatedAt: tx.NowFunc(), UpdatedAt: tx.NowFunc()},
		Revision:      state.Revision,
		Event:         event,
		NextAttemptAt: tx.NowFunc(),
	}
	return tx.Create(&outbox).Error
}

func policyEvent(event string) string {
	if event == "" {
		return "authorization.changed"
	}
	return event
}
