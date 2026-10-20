package service

import (
	"context"
	"errors"
	"slices"

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
}

func NewUserService(userRepo domain.UserRepository, roleRepo domain.RoleRepository) domain.UserService {
	return &userService{
		userRepo: userRepo,
		roleRepo: roleRepo,
	}
}

func notFoundAs(err error, target *coreerrors.DomainError) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return target
	}
	return err
}

func (s *userService) ListUsers(ctx context.Context, f domain.UserFilter) ([]domain.User, int64, error) {
	return s.userRepo.Search(ctx, f)
}

func (s *userService) GetUser(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrUserNotFound)
	}
	return user, nil
}

func (s *userService) CreateUser(ctx context.Context, req domain.CreateUserRequest) (*domain.User, error) {
	if existing, _ := s.userRepo.GetByUsername(ctx, req.Username); existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("用户名已存在")
	}
	if existing, _ := s.userRepo.GetByEmail(ctx, req.Email); existing != nil {
		return nil, coreerrors.ErrResourceConflict.WithMessage("邮箱已被注册")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := domain.User{
		Username: req.Username,
		Email:    req.Email,
		Password: string(hashedPassword),
		Nickname: req.Nickname,
		Status:   domain.StatusEnabled,
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
	if req.Nickname != "" {
		user.Nickname = req.Nickname
	}
	if req.Avatar != "" {
		user.Avatar = req.Avatar
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
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
	user.Status = status
	return s.userRepo.Update(ctx, user)
}

func (s *userService) UpdatePreferences(ctx context.Context, id uuid.UUID, pref domain.UserPreferences) error {
	user, err := s.GetUser(ctx, id)
	if err != nil {
		return err
	}
	user.Preferences = datatypes.NewJSONType(pref)
	return s.userRepo.Update(ctx, user)
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
