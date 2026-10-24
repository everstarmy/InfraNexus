package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type userService struct {
	userRepo     domain.UserRepository
	roleRepo     domain.RoleRepository
	deptRepo     domain.DepartmentRepository
	organization domain.OrganizationUnitOfWork
	authz        domain.AuthorizationService
	now          func() time.Time
}

func NewUserService(userRepo domain.UserRepository, roleRepo domain.RoleRepository, deptRepo domain.DepartmentRepository, organization domain.OrganizationUnitOfWork, authz domain.AuthorizationService) domain.UserService {
	return &userService{
		userRepo:     userRepo,
		roleRepo:     roleRepo,
		deptRepo:     deptRepo,
		organization: organization,
		authz:        authz,
		now:          time.Now,
	}
}

func organizationWriteError(err error) error {
	if errors.Is(err, domain.ErrTreeRevisionConflict) {
		return coreerrors.ErrResourceConflict.WithMessage("组织架构已被其他管理员修改，请刷新后重试")
	}
	return err
}

func notFoundAs(err error, target *coreerrors.DomainError) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return target
	}
	return err
}

func (s *userService) ListUsers(ctx context.Context, f domain.UserFilter) ([]domain.User, int64, error) {
	if f.DepartmentID != nil && !f.NoDepartment {
		ids := []uuid.UUID{*f.DepartmentID}
		if f.IncludeChildren {
			dept, err := s.deptRepo.GetByID(ctx, *f.DepartmentID)
			if err != nil {
				return nil, 0, notFoundAs(err, coreerrors.ErrDepartmentNotFound)
			}
			subtree, err := s.deptRepo.ListSubtree(ctx, dept.TreePath)
			if err != nil {
				return nil, 0, err
			}
			ids = ids[:0]
			for _, d := range subtree {
				ids = append(ids, d.ID)
			}
		}
		f.DepartmentIDs = ids
	}
	return s.userRepo.Search(ctx, f)
}

func (s *userService) GetUser(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrUserNotFound)
	}
	return user, nil
}

func (s *userService) Stats(ctx context.Context) (*domain.UserStats, error) {
	return s.userRepo.Stats(ctx)
}

func (s *userService) checkDepartment(ctx context.Context, deptID *uuid.UUID) error {
	if deptID == nil {
		return nil
	}
	dept, err := s.deptRepo.GetByID(ctx, *deptID)
	if err != nil {
		return notFoundAs(err, coreerrors.ErrDepartmentNotFound)
	}
	if dept.Status != domain.StatusEnabled {
		return coreerrors.ErrDepartmentInvalidParent.WithMessage("目标部门已停用")
	}
	return nil
}

func (s *userService) CreateUser(ctx context.Context, actorID uuid.UUID, req domain.CreateUserRequest) (*domain.User, error) {
	if err := CheckPasswordStrength(req.Password); err != nil {
		return nil, err
	}
	if existing, err := s.userRepo.GetByUsername(ctx, "", req.Username); err == nil && existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("用户名已存在")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if existing, err := s.userRepo.GetByEmail(ctx, req.Email); err == nil && existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("邮箱已被注册")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if len(req.RoleIDs) > 0 {
		if err := s.requireActorAPI(ctx, actorID, "PUT", "/api/v1/users/:id/roles"); err != nil {
			return nil, err
		}
		if err := s.checkRoleGrantScope(ctx, actorID, req.RoleIDs); err != nil {
			return nil, err
		}
	}
	if req.DepartmentID != nil {
		if err := s.requireActorAPI(ctx, actorID, "PUT", "/api/v1/users/:id/department"); err != nil {
			return nil, err
		}
		if req.ExpectedRevision < 1 {
			return nil, coreerrors.ErrParamInvalid.WithMessage("设置初始部门时必须提供 expected_revision")
		}
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := domain.User{
		Username:     req.Username,
		Email:        req.Email,
		Password:     string(hashedPassword),
		Nickname:     req.Nickname,
		Status:       domain.StatusEnabled,
		AuthType:     domain.AuthTypeLocal,
		DepartmentID: req.DepartmentID,
	}

	var created *domain.User
	create := func(writeCtx context.Context) error {
		if err := s.checkDepartment(writeCtx, req.DepartmentID); err != nil {
			return err
		}
		if err := s.userRepo.CreateWithRoles(writeCtx, &user, uniqueUUIDs(req.RoleIDs)); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return coreerrors.ErrRoleNotFound.WithMessage("部分角色不存在")
			}
			return err
		}
		var err error
		created, err = s.userRepo.GetByID(writeCtx, user.ID)
		return err
	}
	if req.DepartmentID != nil {
		if _, err := s.organization.Write(ctx, &req.ExpectedRevision, create); err != nil {
			return nil, organizationWriteError(err)
		}
	} else if err := create(ctx); err != nil {
		return nil, err
	}
	return created, nil
}

func (s *userService) UpdateUser(ctx context.Context, actorID, id uuid.UUID, req domain.UpdateUserRequest) (*domain.User, error) {
	if req.ExpectedRevision <= 0 {
		return nil, coreerrors.ErrParamInvalid.WithMessage("expected_revision 必须为正整数")
	}
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return nil, err
	}

	values := make(map[string]any, 4)
	if req.Email != nil && *req.Email != user.Email {
		if existing, err := s.userRepo.GetByEmail(ctx, *req.Email); err == nil && existing.ID != user.ID {
			return nil, coreerrors.ErrResourceConflict.WithMessage("邮箱已被注册")
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		values["email"] = *req.Email
	}
	if req.Nickname != nil {
		values["nickname"] = *req.Nickname
	}
	if req.Avatar != nil {
		values["avatar"] = *req.Avatar
	}
	if len(values) > 0 {
		if user.EditRevision != req.ExpectedRevision {
			return nil, coreerrors.ErrResourceConflict.WithMessage("用户资料已被其他管理员修改，请保留草稿并刷新后重试")
		}
		updateErr := s.userRepo.UpdateColumnsCAS(ctx, id, req.ExpectedRevision, values)
		if errors.Is(updateErr, domain.ErrEditRevisionConflict) {
			return nil, coreerrors.ErrResourceConflict.WithMessage("用户资料已被其他管理员修改，请保留草稿并刷新后重试")
		}
		if updateErr != nil {
			return nil, updateErr
		}
	}

	return s.userRepo.GetByID(ctx, id)
}

func (s *userService) SetDepartment(ctx context.Context, actorID, id uuid.UUID, departmentID *uuid.UUID, expectedRevision int64) (*domain.User, error) {
	if err := s.requireActorAPI(ctx, actorID, "PUT", "/api/v1/users/:id/department"); err != nil {
		return nil, err
	}
	var updated *domain.User
	_, err := s.organization.Write(ctx, &expectedRevision, func(txctx context.Context) error {
		if _, err := s.userRepo.GetByID(txctx, id); err != nil {
			return notFoundAs(err, coreerrors.ErrUserNotFound)
		}
		if err := s.checkDepartment(txctx, departmentID); err != nil {
			return err
		}
		if err := s.userRepo.UpdateColumns(txctx, id, map[string]any{"department_id": departmentID}); err != nil {
			return err
		}
		var err error
		updated, err = s.userRepo.GetByID(txctx, id)
		return err
	})
	if err != nil {
		return nil, organizationWriteError(err)
	}
	return updated, nil
}

func (s *userService) DeleteUser(ctx context.Context, actorID, id uuid.UUID) error {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return err
	}
	if user.ID == actorID {
		return coreerrors.ErrSelfOperationDenied
	}
	if user.BuiltIn {
		return coreerrors.ErrBuiltinProtected
	}
	// Departments may reference the user as leader regardless of membership, so
	// the deletion and leader cleanup share one organization write.
	_, err = s.organization.Write(ctx, nil, func(txctx context.Context) error {
		current, err := s.userRepo.GetByID(txctx, id)
		if err != nil {
			return notFoundAs(err, coreerrors.ErrUserNotFound)
		}
		if current.ID == actorID {
			return coreerrors.ErrSelfOperationDenied
		}
		if current.BuiltIn {
			return coreerrors.ErrBuiltinProtected
		}
		if err := s.deptRepo.ClearLeader(txctx, id); err != nil {
			return err
		}
		return s.userRepo.Delete(txctx, id)
	})
	return err
}

func (s *userService) ToggleStatus(ctx context.Context, actorID, id uuid.UUID, status int, expectedRevision int64) (*domain.User, error) {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := checkStatusChange(actorID, user, status); err != nil {
		return nil, err
	}
	if expectedRevision < 1 {
		// Preserve compatibility with existing API clients while still applying
		// the mutation through the atomic compare-and-set repository operation.
		expectedRevision = user.EditRevision
	}
	if user.EditRevision != expectedRevision {
		return nil, coreerrors.ErrResourceConflict.WithMessage("用户状态已被其他管理员修改，请刷新后重试")
	}
	if err := s.userRepo.UpdateStatus(ctx, id, status, expectedRevision); err != nil {
		if errors.Is(err, domain.ErrEditRevisionConflict) {
			return nil, coreerrors.ErrResourceConflict.WithMessage("用户状态已被其他管理员修改，请刷新后重试")
		}
		return nil, err
	}
	return s.GetUser(ctx, id)
}

func (s *userService) ResetPassword(ctx context.Context, actorID, id uuid.UUID, password string) error {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return err
	}
	if user.AuthType != domain.AuthTypeLocal {
		return coreerrors.ErrExternalAccountManaged.WithMessage("域账号的密码由目录服务管理，请在 AD/LDAP 中重置")
	}
	if err := CheckPasswordStrength(password); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.userRepo.UpdateColumns(ctx, id, map[string]any{
		"password":            string(hash),
		"sessions_revoked_at": s.now(),
	})
}

func (s *userService) AssignRoles(ctx context.Context, actorID, id uuid.UUID, roleIDs []uuid.UUID) (*domain.User, error) {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.checkRoleChange(ctx, actorID, user, roleIDs); err != nil {
		return nil, err
	}
	if err := s.userRepo.AssignRoles(ctx, id, uniqueUUIDs(roleIDs)); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, coreerrors.ErrRoleNotFound.WithMessage("部分角色不存在")
		}
		return nil, err
	}
	return s.userRepo.GetByID(ctx, id)
}

func (s *userService) BatchMoveDepartment(ctx context.Context, userIDs []uuid.UUID, deptID uuid.UUID, expectedRevision int64) (int64, error) {
	ordered := slices.Clone(userIDs)
	slices.SortFunc(ordered, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	for i := 1; i < len(ordered); i++ {
		if ordered[i] == ordered[i-1] {
			return 0, coreerrors.ErrParamInvalid.WithMessage("批量调岗用户 ID 不可重复")
		}
	}
	var moved int64
	_, err := s.organization.Write(ctx, &expectedRevision, func(txctx context.Context) error {
		if err := s.checkDepartment(txctx, &deptID); err != nil {
			return err
		}
		found, err := s.userRepo.FindByIDs(txctx, ordered)
		if err != nil {
			return err
		}
		if len(found) != len(ordered) {
			return coreerrors.ErrUserNotFound.WithMessage("部分用户不存在或已被删除")
		}
		moved, err = s.userRepo.MoveToDepartment(txctx, ordered, deptID)
		if err != nil {
			return err
		}
		if moved != int64(len(ordered)) {
			return coreerrors.ErrUserNotFound.WithMessage("调岗影响人数与请求不一致")
		}
		return nil
	})
	if err != nil {
		return 0, organizationWriteError(err)
	}
	return moved, nil
}

func (s *userService) UpdatePreferences(ctx context.Context, id uuid.UUID, pref domain.UserPreferences) error {
	if pref.SessionTimeout < 0 || pref.SessionTimeout > 2592000 {
		return coreerrors.ErrParamInvalid.WithMessage("会话超时时间设置非法（范围：0 ~ 2592000秒）")
	}
	if _, err := s.GetUser(ctx, id); err != nil {
		return err
	}
	return s.userRepo.UpdateColumns(ctx, id, map[string]any{"preferences": datatypes.NewJSONType(pref)})
}

func checkStatusChange(actorID uuid.UUID, user *domain.User, status int) error {
	if status == domain.StatusEnabled {
		return nil
	}
	if user.ID == actorID {
		return coreerrors.ErrSelfOperationDenied
	}
	if user.BuiltIn {
		return coreerrors.ErrBuiltinProtected
	}
	return nil
}

func (s *userService) checkRoleChange(ctx context.Context, actorID uuid.UUID, user *domain.User, roleIDs []uuid.UUID) error {
	if !user.BuiltIn {
		return s.checkRoleGrantScope(ctx, actorID, roleIDs)
	}
	adminRole, err := s.roleRepo.GetByCode(ctx, domain.AdminRoleCode)
	if err != nil {
		return notFoundAs(err, coreerrors.ErrRoleNotFound)
	}
	if !slices.Contains(roleIDs, adminRole.ID) {
		return coreerrors.ErrBuiltinProtected.WithMessage("内置管理员账号必须保留超级管理员角色")
	}
	return s.checkRoleGrantScope(ctx, actorID, roleIDs)
}

func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(ids))
	unique := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
}

func (s *userService) actorRoles(ctx context.Context, actorID uuid.UUID) ([]string, error) {
	actor, err := s.userRepo.GetByID(ctx, actorID)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrUnauthorized)
	}
	roles := make([]string, 0, len(actor.Roles))
	for _, role := range actor.Roles {
		if role.Status == domain.StatusEnabled {
			roles = append(roles, role.Code)
		}
	}
	return roles, nil
}

func (s *userService) requireActorAPI(ctx context.Context, actorID uuid.UUID, method, path string) error {
	if s.authz == nil {
		return coreerrors.ErrPermissionDenied
	}
	roles, err := s.actorRoles(ctx, actorID)
	if err != nil {
		return err
	}
	allowed, err := s.authz.HasAPIAccess(ctx, roles, method, path)
	if err != nil {
		return err
	}
	if !allowed {
		return coreerrors.ErrPermissionDenied
	}
	return nil
}

func (s *userService) checkRoleGrantScope(ctx context.Context, actorID uuid.UUID, roleIDs []uuid.UUID) error {
	roles, err := s.actorRoles(ctx, actorID)
	if err != nil {
		return err
	}
	admin := slices.Contains(roles, domain.AdminRoleCode)
	for _, roleID := range uniqueUUIDs(roleIDs) {
		role, err := s.roleRepo.GetByID(ctx, roleID)
		if err != nil {
			return notFoundAs(err, coreerrors.ErrRoleNotFound)
		}
		if role.Code == domain.AdminRoleCode {
			if !admin {
				return coreerrors.ErrPermissionDenied.WithMessage("仅超级管理员可以授予超级管理员角色")
			}
			continue
		}
		if admin {
			continue
		}
		for _, permission := range role.Permissions {
			if permission.Type != domain.PermTypeAPI {
				continue
			}
			if permission.Method == "*" || strings.Contains(permission.Path, "*") {
				return coreerrors.ErrPermissionDenied.WithMessage("只能授予自身已有的 API 权限范围")
			}
			allowed, err := s.authz.HasAPIAccess(ctx, roles, permission.Method, permission.Path)
			if err != nil {
				return err
			}
			if !allowed {
				return coreerrors.ErrPermissionDenied.WithMessage("只能授予自身已有的 API 权限范围")
			}
		}
	}
	return nil
}
