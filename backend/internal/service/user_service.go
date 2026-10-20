package service

import (
	"context"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"

	"infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type userService struct {
	userRepo domain.UserRepository
}

func NewUserService(userRepo domain.UserRepository) domain.UserService {
	return &userService{
		userRepo: userRepo,
	}
}

func (s *userService) Authenticate(ctx context.Context, username, password string) (*domain.User, error) {
	user, err := s.userRepo.GetByUsername(ctx, username)
	if err != nil {
		return nil, errors.ErrInvalidCredentials
	}
	if user.Status != 1 {
		return nil, errors.ErrAccountDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, errors.ErrInvalidCredentials
	}
	return user, nil
}

func (s *userService) CreateUser(ctx context.Context, req domain.CreateUserRequest) (*domain.User, error) {
	// 唯一性校验
	if existing, _ := s.userRepo.GetByUsername(ctx, req.Username); existing != nil {
		return nil, errors.NewDomainError(409, 409001, "用户名已存在")
	}
	if existing, _ := s.userRepo.GetByEmail(ctx, req.Email); existing != nil {
		return nil, errors.NewDomainError(409, 409001, "邮箱已被注册")
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
		Status:   1,
	}

	if err := s.userRepo.Create(ctx, &user); err != nil {
		return nil, err
	}

	if len(req.RoleIDs) > 0 {
		_ = s.userRepo.AssignRoles(ctx, user.ID, req.RoleIDs)
	}

	return s.userRepo.GetByID(ctx, user.ID)
}

func (s *userService) UpdateUser(ctx context.Context, id uuid.UUID, req domain.UpdateUserRequest) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, errors.ErrUserNotFound
	}

	if req.Nickname != "" {
		user.Nickname = req.Nickname
	}
	if req.Avatar != "" {
		user.Avatar = req.Avatar
	}
	if req.Status != nil {
		user.Status = *req.Status
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	if req.RoleIDs != nil {
		_ = s.userRepo.AssignRoles(ctx, id, req.RoleIDs)
	}

	return s.userRepo.GetByID(ctx, id)
}

func (s *userService) DeleteUser(ctx context.Context, id uuid.UUID) error {
	return s.userRepo.Delete(ctx, id)
}

func (s *userService) ToggleStatus(ctx context.Context, id uuid.UUID, status int) error {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return errors.ErrUserNotFound
	}
	user.Status = status
	return s.userRepo.Update(ctx, user)
}

func (s *userService) UpdatePreferences(ctx context.Context, id uuid.UUID, pref domain.UserPreferences) error {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return errors.ErrUserNotFound
	}
	user.Preferences = datatypes.NewJSONType(pref)
	return s.userRepo.Update(ctx, user)
}
