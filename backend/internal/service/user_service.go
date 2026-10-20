package service

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type userService struct {
	userRepo domain.UserRepository
	roleRepo domain.RoleRepository
	deptRepo domain.DepartmentRepository
	now      func() time.Time
}

func NewUserService(userRepo domain.UserRepository, roleRepo domain.RoleRepository, deptRepo domain.DepartmentRepository) domain.UserService {
	return &userService{
		userRepo: userRepo,
		roleRepo: roleRepo,
		deptRepo: deptRepo,
		now:      time.Now,
	}
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

func (s *userService) CreateUser(ctx context.Context, req domain.CreateUserRequest) (*domain.User, error) {
	if err := CheckPasswordStrength(req.Password); err != nil {
		return nil, err
	}
	if existing, _ := s.userRepo.GetByUsername(ctx, "", req.Username); existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("用户名已存在")
	}
	if existing, _ := s.userRepo.GetByEmail(ctx, req.Email); existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("邮箱已被注册")
	}
	if err := s.checkDepartment(ctx, req.DepartmentID); err != nil {
		return nil, err
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

	if err := s.userRepo.Create(ctx, &user); err != nil {
		return nil, err
	}

	if len(req.RoleIDs) > 0 {
		if err := s.userRepo.AssignRoles(ctx, user.ID, req.RoleIDs); err != nil {
			return nil, err
		}
	}

	return s.userRepo.GetByID(ctx, user.ID)
}

func (s *userService) UpdateUser(ctx context.Context, actorID, id uuid.UUID, req domain.UpdateUserRequest) (*domain.User, error) {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Status != nil {
		if err := checkStatusChange(actorID, user, *req.Status); err != nil {
			return nil, err
		}
		user.Status = *req.Status
	}
	if req.RoleIDs != nil {
		if err := s.checkRoleChange(ctx, user, req.RoleIDs); err != nil {
			return nil, err
		}
	}
	if req.DepartmentID != nil {
		if err := s.checkDepartment(ctx, req.DepartmentID); err != nil {
			return nil, err
		}
		user.DepartmentID = req.DepartmentID
	}
	if req.Email != nil && *req.Email != user.Email {
		if existing, _ := s.userRepo.GetByEmail(ctx, *req.Email); existing != nil && existing.ID != user.ID {
			return nil, coreerrors.ErrResourceConflict.WithMessage("邮箱已被注册")
		}
		user.Email = *req.Email
	}
	if req.Nickname != "" {
		user.Nickname = req.Nickname
	}
	if req.Avatar != "" {
		user.Avatar = req.Avatar
	}

	if err := s.userRepo.UpdateColumns(ctx, id, map[string]any{
		"status":        user.Status,
		"department_id": user.DepartmentID,
		"email":         user.Email,
		"nickname":      user.Nickname,
		"avatar":        user.Avatar,
	}); err != nil {
		return nil, err
	}

	if req.RoleIDs != nil {
		if err := s.userRepo.AssignRoles(ctx, id, req.RoleIDs); err != nil {
			return nil, err
		}
	}

	return s.userRepo.GetByID(ctx, id)
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
	return s.userRepo.Delete(ctx, id)
}

func (s *userService) ToggleStatus(ctx context.Context, actorID, id uuid.UUID, status int) error {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return err
	}
	if err := checkStatusChange(actorID, user, status); err != nil {
		return err
	}
	return s.userRepo.UpdateColumns(ctx, id, map[string]any{"status": status})
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
	if err := s.checkRoleChange(ctx, user, roleIDs); err != nil {
		return nil, err
	}
	if err := s.userRepo.AssignRoles(ctx, id, roleIDs); err != nil {
		return nil, err
	}
	return s.userRepo.GetByID(ctx, id)
}

func (s *userService) BatchMoveDepartment(ctx context.Context, userIDs []uuid.UUID, deptID uuid.UUID) (int64, error) {
	if err := s.checkDepartment(ctx, &deptID); err != nil {
		return 0, err
	}
	unique := slices.Compact(slices.SortedFunc(slices.Values(userIDs), func(a, b uuid.UUID) int {
		return slices.Compare(a[:], b[:])
	}))
	found, err := s.userRepo.FindByIDs(ctx, unique)
	if err != nil {
		return 0, err
	}
	if len(found) != len(unique) {
		return 0, coreerrors.ErrUserNotFound.WithMessage("部分用户不存在或已被删除")
	}
	return s.userRepo.MoveToDepartment(ctx, unique, deptID)
}

func (s *userService) UpdatePreferences(ctx context.Context, id uuid.UUID, pref domain.UserPreferences) error {
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

func (s *userService) checkRoleChange(ctx context.Context, user *domain.User, roleIDs []uuid.UUID) error {
	if !user.BuiltIn {
		return nil
	}
	adminRole, err := s.roleRepo.GetByCode(ctx, domain.AdminRoleCode)
	if err != nil {
		return notFoundAs(err, coreerrors.ErrRoleNotFound)
	}
	if !slices.Contains(roleIDs, adminRole.ID) {
		return coreerrors.ErrBuiltinProtected.WithMessage("内置管理员账号必须保留超级管理员角色")
	}
	return nil
}
