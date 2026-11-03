package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

func validateUserSelection(selection domain.UserSelection) error {
	if selection.Mode != "page" && selection.Mode != "ids" && selection.Mode != "allMatching" {
		return coreerrors.ErrParamInvalid.WithMessage("选择模式无效")
	}
	if len(selection.IDs) > domain.TableSelectionLimit || len(selection.ExcludedIDs) > domain.TableSelectionLimit {
		return coreerrors.ErrParamInvalid.WithMessage("选择或排除集合最多 500 项")
	}
	if selection.Mode == "allMatching" {
		if len(selection.IDs) > 0 {
			return coreerrors.ErrParamInvalid
		}
	} else if len(selection.IDs) == 0 || len(selection.ExcludedIDs) > 0 {
		return coreerrors.ErrParamInvalid
	}
	for _, ids := range [][]uuid.UUID{selection.IDs, selection.ExcludedIDs, selection.Query.RoleIDs} {
		if len(ids) > domain.TableSelectionLimit {
			return coreerrors.ErrParamInvalid
		}
		seen := map[uuid.UUID]bool{}
		for _, id := range ids {
			if id == uuid.Nil || seen[id] {
				return coreerrors.ErrParamInvalid
			}
			seen[id] = true
		}
	}
	q := selection.Query
	if len([]rune(q.Keyword)) > 200 || len(q.Statuses) > 2 || len(q.AuthTypes) > 3 || (q.NoDepartment && q.DepartmentID != nil) {
		return coreerrors.ErrParamInvalid
	}
	for _, status := range q.Statuses {
		if status != 1 && status != 2 {
			return coreerrors.ErrParamInvalid
		}
	}
	for _, kind := range q.AuthTypes {
		if !slices.Contains([]string{"local", "ad", "ldap"}, kind) {
			return coreerrors.ErrParamInvalid
		}
	}
	if q.Query != nil {
		if err := q.Query.Validate(domain.UserQueryFields); err != nil {
			return coreerrors.ErrParamInvalid.WithMessage("查询条件无效")
		}
	}
	return nil
}
func (s *userService) resolveUserSelection(ctx context.Context, selection domain.UserSelection, limit int) ([]domain.User, error) {
	if err := validateUserSelection(selection); err != nil {
		return nil, err
	}
	q := selection.Query
	filter := domain.UserFilter{Page: 1, PageSize: limit + len(selection.ExcludedIDs) + 1, Keyword: q.Keyword, Statuses: q.Statuses, AuthTypes: q.AuthTypes, RoleIDs: q.RoleIDs, DepartmentID: q.DepartmentID, NoDepartment: q.NoDepartment, IncludeChildren: q.IncludeChildren, Query: q.Query}
	if selection.Mode != "allMatching" {
		filter.IDs = selection.IDs
	}
	users, total, err := s.ListUsers(ctx, filter)
	if err != nil {
		return nil, err
	}
	if total > int64(limit+len(selection.ExcludedIDs)) {
		return nil, coreerrors.ErrParamInvalid.WithMessage(fmt.Sprintf("本次操作最多 %d 条，请缩小选择范围", limit))
	}
	filtered := make([]domain.User, 0, len(users))
	for _, user := range users {
		if !slices.Contains(selection.ExcludedIDs, user.ID) {
			filtered = append(filtered, user)
		}
	}
	if len(filtered) > limit {
		return nil, coreerrors.ErrParamInvalid.WithMessage(fmt.Sprintf("本次操作最多 %d 条", limit))
	}
	return filtered, nil
}
func (s *userService) requireTableAction(ctx context.Context, actorID uuid.UUID, method, path string) error {
	actor, err := s.GetUser(ctx, actorID)
	if err != nil {
		return err
	}
	if actor.Status != domain.StatusEnabled {
		return coreerrors.ErrPermissionDenied
	}
	if err := s.requireActorAPI(ctx, actorID, "GET", "/api/v1/users"); err != nil {
		return err
	}
	return s.requireActorAPI(ctx, actorID, method, path)
}
func (s *userService) PreviewStatus(ctx context.Context, actorID uuid.UUID, req domain.UserBatchRequest) (*domain.UserBatchPreview, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if req.Status != 1 && req.Status != 2 {
		return nil, coreerrors.ErrParamInvalid
	}
	if err := s.requireTableAction(ctx, actorID, "PATCH", "/api/v1/users/:id/status"); err != nil {
		return nil, err
	}
	users, err := s.resolveUserSelection(ctx, req.Selection, domain.UserBatchLimit)
	if err != nil {
		return nil, err
	}
	result := &domain.UserBatchPreview{Matched: len(users), Items: make([]domain.UserBatchItem, 0, len(users))}
	for _, user := range users {
		item := domain.UserBatchItem{ID: user.ID, Revision: user.EditRevision, Outcome: "eligible"}
		if err := checkStatusChange(actorID, &user, req.Status); err != nil {
			item.Outcome = "skipped"
			item.Reason = "系统账号或当前账号不可停用"
		} else if user.Status == req.Status {
			item.Outcome = "skipped"
			item.Reason = "已经是目标状态"
		}
		if item.Outcome == "eligible" {
			result.Eligible++
		} else {
			result.Skipped++
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}
func (s *userService) BatchStatus(ctx context.Context, actorID uuid.UUID, req domain.UserBatchRequest) (*domain.UserBatchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if (req.Status != 1 && req.Status != 2) || len(req.Items) == 0 || len(req.Items) > domain.UserBatchLimit {
		return nil, coreerrors.ErrParamInvalid
	}
	seen := map[uuid.UUID]bool{}
	for _, item := range req.Items {
		if item.ID == uuid.Nil || item.Revision < 1 || seen[item.ID] {
			return nil, coreerrors.ErrParamInvalid
		}
		seen[item.ID] = true
	}
	if err := s.requireTableAction(ctx, actorID, "PATCH", "/api/v1/users/:id/status"); err != nil {
		return nil, err
	}
	users, err := s.resolveUserSelection(ctx, req.Selection, domain.UserBatchLimit)
	if err != nil {
		return nil, err
	}
	candidates := map[uuid.UUID]bool{}
	result := &domain.UserBatchResult{Items: make([]domain.UserBatchItem, 0, len(req.Items))}
	for _, user := range users {
		candidates[user.ID] = true
		if !seen[user.ID] {
			result.NewMatches++
		}
	}
	for _, approved := range req.Items {
		item := domain.UserBatchItem{ID: approved.ID, Revision: approved.Revision, Outcome: "skipped"}
		switch {
		case !candidates[approved.ID]:
			item.Reason = "记录已删除或不再符合当前范围"
		case ctx.Err() != nil:
			item.Outcome = "failed"
			item.Reason = "处理超时，请重试未完成项"
			item.Retryable = true
		default:
			// Recheck current actor permissions and target revision for each item.
			if err := s.requireTableAction(ctx, actorID, "POST", "/api/v1/users/batch-status"); err != nil {
				item.Outcome = "failed"
				item.Reason = "批量操作权限已变化"
				break
			}
			if err := s.requireActorAPI(ctx, actorID, "PATCH", "/api/v1/users/:id/status"); err != nil {
				item.Outcome = "failed"
				item.Reason = "启停权限已变化"
				break
			}
			current, err := s.GetUser(ctx, approved.ID)
			if err != nil {
				item.Outcome = "failed"
				item.Reason = "记录不可用"
				break
			}
			if current.Status == req.Status {
				item.Reason = "已经是目标状态，无需重复执行"
				break
			}
			if err := checkStatusChange(actorID, current, req.Status); err != nil {
				item.Reason = "系统账号或当前账号不可停用"
				break
			}
			_, err = s.ToggleStatus(ctx, actorID, approved.ID, req.Status, approved.Revision)
			if err == nil {
				item.Outcome = "success"
				break
			}
			classification := coreerrors.Classify(err)
			item.Outcome = "failed"
			if classification.HTTPStatus == 409 {
				item.Reason = "数据版本已变化，请刷新后重新预检"
			} else if classification.HTTPStatus >= 500 {
				item.Reason = "暂时无法更新，可重试"
				item.Retryable = true
			} else {
				item.Reason = "当前记录不允许此操作"
			}
		}
		switch item.Outcome {
		case "success":
			result.Success++
		case "failed":
			result.Failed++
		default:
			result.Skipped++
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}

var userExportHeaders = map[string]string{"id": "ID", "username": "用户名", "nickname": "姓名", "email": "邮箱", "status": "状态", "auth_type": "身份来源", "domain": "域", "department": "部门", "roles": "角色", "created_at": "创建时间（UTC）", "last_login_at": "最近登录（UTC）", "edit_revision": "资料版本"}

func spreadsheetSafe(value string) string {
	trimmed := strings.TrimLeftFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\ufeff' || r == '\u200b' })
	if strings.HasPrefix(value, "\t") || strings.HasPrefix(value, "\r") || strings.HasPrefix(value, "\n") || (len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0]))) {
		return "'" + value
	}
	return value
}
func userExportValue(user domain.User, field string) string {
	switch field {
	case "id":
		return user.ID.String()
	case "username":
		return user.Username
	case "nickname":
		return user.Nickname
	case "email":
		return user.Email
	case "status":
		if user.Status == 1 {
			return "启用"
		}
		return "停用"
	case "auth_type":
		switch user.AuthType {
		case "local":
			return "本地"
		case "ad":
			return "AD"
		default:
			return "LDAP"
		}
	case "domain":
		return user.Domain
	case "department":
		if user.Department != nil {
			return user.Department.Name
		}
		return ""
	case "roles":
		names := make([]string, 0, len(user.Roles))
		for _, role := range user.Roles {
			names = append(names, role.Name)
		}
		slices.Sort(names)
		return strings.Join(names, "、")
	case "created_at":
		return user.CreatedAt.UTC().Format(time.RFC3339Nano)
	case "last_login_at":
		if user.LastLoginAt != nil {
			return user.LastLoginAt.UTC().Format(time.RFC3339Nano)
		}
		return ""
	case "edit_revision":
		return strconv.FormatInt(user.EditRevision, 10)
	}
	return ""
}
func (s *userService) ExportUsers(ctx context.Context, actorID uuid.UUID, req domain.UserExportRequest) (*domain.UserExport, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := s.requireTableAction(ctx, actorID, "POST", "/api/v1/users/export"); err != nil {
		return nil, err
	}
	if len(req.Fields) == 0 || len(req.Fields) > len(userExportHeaders) {
		return nil, coreerrors.ErrParamInvalid
	}
	headers := make([]string, len(req.Fields))
	seen := map[string]bool{}
	for i, field := range req.Fields {
		title, ok := userExportHeaders[field]
		if !ok || seen[field] {
			return nil, coreerrors.ErrParamInvalid.WithMessage("导出字段不允许或重复")
		}
		seen[field] = true
		headers[i] = title
	}
	users, err := s.resolveUserSelection(ctx, req.Selection, domain.UserExportLimit)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	buffer.WriteString("\xef\xbb\xbf")
	writer := csv.NewWriter(&buffer)
	writer.UseCRLF = true
	if err := writer.Write(headers); err != nil {
		return nil, err
	}
	for _, user := range users {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		row := make([]string, len(req.Fields))
		for i, field := range req.Fields {
			row[i] = spreadsheetSafe(userExportValue(user, field))
		}
		if err := writer.Write(row); err != nil {
			return nil, err
		}
		if buffer.Len() > 8*1024*1024 {
			return nil, coreerrors.ErrParamInvalid.WithMessage("导出超过 8MiB，请缩小范围")
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	if buffer.Len() > 8*1024*1024 {
		return nil, coreerrors.ErrParamInvalid.WithMessage("导出超过 8MiB，请缩小范围")
	}
	// Authorization may have changed while materializing the bounded file.
	if err := s.requireTableAction(ctx, actorID, "POST", "/api/v1/users/export"); err != nil {
		return nil, err
	}
	return &domain.UserExport{Content: buffer.Bytes(), Rows: len(users)}, nil
}
