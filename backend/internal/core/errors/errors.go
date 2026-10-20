package errors

import (
	"errors"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
)

type DomainError struct {
	HTTPStatus int
	BizCode    response.BusinessCode
	Message    string
	Err        error
}

func (e *DomainError) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}

func (e *DomainError) Unwrap() error {
	return e.Err
}

func NewDomainError(httpStatus int, bizCode response.BusinessCode, message string, err ...error) *DomainError {
	var cause error
	if len(err) > 0 {
		cause = err[0]
	}
	return &DomainError{
		HTTPStatus: httpStatus,
		BizCode:    bizCode,
		Message:    message,
		Err:        cause,
	}
}

// 常见业务领域预定义错误
var (
	ErrUnauthorized        = NewDomainError(fiber.StatusUnauthorized, response.CodeTokenExpired, "认证凭据无效或已过期")
	ErrInvalidCredentials  = NewDomainError(fiber.StatusUnauthorized, response.CodeInvalidCredentials, "用户名或密码错误")
	ErrPermissionDenied    = NewDomainError(fiber.StatusForbidden, response.CodePermissionDenied, "没有权限执行该操作")
	ErrAccountDisabled     = NewDomainError(fiber.StatusForbidden, response.CodeAccountDisabled, "账号已被停用，请联系管理员")
	ErrUserNotFound        = NewDomainError(fiber.StatusNotFound, response.CodeUserNotFound, "目标用户不存在")
	ErrRoleNotFound        = NewDomainError(fiber.StatusNotFound, response.CodeRoleNotFound, "目标角色不存在")
	ErrResourceConflict    = NewDomainError(fiber.StatusConflict, response.CodeResourceConflict, "资源已存在或唯一性冲突")
	ErrInternalDatabase    = NewDomainError(fiber.StatusInternalServerError, response.CodeDatabaseError, "数据库执行异常")
)

// GlobalErrorHandler Fiber 全局错误拦截器
func GlobalErrorHandler(c fiber.Ctx, err error) error {
	var domainErr *DomainError
	if errors.As(err, &domainErr) {
		return response.Error(c, domainErr.HTTPStatus, domainErr.BizCode, domainErr.Message)
	}

	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		return response.Error(c, fiberErr.Code, response.CodeInternalError, fiberErr.Message)
	}

	// 未知错误
	return response.Error(c, fiber.StatusInternalServerError, response.CodeInternalError, "系统内部繁忙，请稍后重试")
}
