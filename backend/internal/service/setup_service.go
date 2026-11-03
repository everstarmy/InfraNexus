package service

import (
	"context"
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type setupService struct{ repo domain.SetupRepository }

func NewSetupService(repo domain.SetupRepository) domain.SetupService {
	return &setupService{repo: repo}
}

func (s *setupService) Status(ctx context.Context) (domain.SetupStatus, error) {
	initialized, err := s.repo.Initialized(ctx)
	if err != nil {
		return domain.SetupStatus{}, fmt.Errorf("read administrator setup status: %w", err)
	}
	return domain.SetupStatus{Initialized: initialized}, nil
}

func (s *setupService) Initialize(ctx context.Context, req domain.SetupRequest) error {
	status, err := s.Status(ctx)
	if err != nil {
		return err
	}
	if status.Initialized {
		return coreerrors.ErrPermissionDenied.WithMessage("管理员已初始化，不能重复创建")
	}
	if len(req.Password) > 72 {
		return coreerrors.ErrParamInvalid.WithMessage("密码不能超过 72 字节")
	}
	if err := CheckPasswordStrength(req.Password); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash initial administrator password: %w", err)
	}
	user := &domain.User{
		Username: "admin", Email: "admin@infranexus.com", Password: string(hash),
		Nickname: "系统管理员", Status: domain.StatusEnabled, AuthType: domain.AuthTypeLocal, BuiltIn: true,
	}
	if err := s.repo.Initialize(ctx, user); err != nil {
		if errors.Is(err, domain.ErrAlreadyInitialized) {
			return coreerrors.ErrPermissionDenied.WithMessage("管理员已初始化，不能重复创建")
		}
		return fmt.Errorf("initialize administrator: %w", err)
	}
	return nil
}
