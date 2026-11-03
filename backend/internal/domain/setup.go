package domain

import (
	"context"
	"errors"
)

var ErrAlreadyInitialized = errors.New("administrator already initialized")

type SetupStatus struct {
	Initialized bool `json:"initialized"`
}

type SetupRequest struct {
	Password string `json:"password" validate:"required,max=72"`
}

type SetupRepository interface {
	Initialized(ctx context.Context) (bool, error)
	Initialize(ctx context.Context, user *User) error
}

type SetupService interface {
	Status(ctx context.Context) (SetupStatus, error)
	Initialize(ctx context.Context, req SetupRequest) error
}
