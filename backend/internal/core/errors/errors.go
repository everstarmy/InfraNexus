package errors

import (
	"errors"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"

	"infranexus/internal/core/response"
)

type DomainError struct {
	HTTPStatus int
	BizCode    response.BusinessCode
	Message    string
	Data       any
	Err        error
}

type Classification struct {
	HTTPStatus int
	BizCode    response.BusinessCode
	Message    string
	Cause      error
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

func (e *DomainError) WithData(data any) *DomainError {
	clone := *e
	clone.Data = data
	return &clone
}

func (e *DomainError) WithMessage(message string) *DomainError {
	clone := *e
	clone.Message = message
	return &clone
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

// Classify maps an error without writing to the response, so middleware and the
// global handler can report the same status without invoking response handling twice.
func Classify(err error) Classification {
	if domainErr, ok := errors.AsType[*DomainError](err); ok {
		return Classification{HTTPStatus: domainErr.HTTPStatus, BizCode: domainErr.BizCode, Message: domainErr.Message, Cause: domainErr.Err}
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return Classification{HTTPStatus: ErrResourceConflict.HTTPStatus, BizCode: ErrResourceConflict.BizCode, Message: ErrResourceConflict.Message, Cause: err}
	}
	if fiberErr, ok := errors.AsType[*fiber.Error](err); ok {
		return Classification{HTTPStatus: fiberErr.Code, BizCode: response.BusinessCode(fiberErr.Code * 1000), Message: fiberErr.Message, Cause: err}
	}
	return Classification{HTTPStatus: fiber.StatusInternalServerError, BizCode: response.CodeInternalError, Message: "系统内部繁忙，请稍后重试", Cause: err}
}

// 常见业务领域预定义错误
var (
	ErrUnauthorized             = NewDomainError(fiber.StatusUnauthorized, response.CodeTokenExpired, "认证凭据无效或已过期")
	ErrInvalidCredentials       = NewDomainError(fiber.StatusUnauthorized, response.CodeInvalidCredentials, "用户名或密码错误")
	ErrParamInvalid             = NewDomainError(fiber.StatusBadRequest, response.CodeParamInvalid, "请求参数校验失败")
	ErrPermissionDenied         = NewDomainError(fiber.StatusForbidden, response.CodePermissionDenied, "没有权限执行该操作")
	ErrAccountDisabled          = NewDomainError(fiber.StatusForbidden, response.CodeAccountDisabled, "账号已被停用，请联系管理员")
	ErrBuiltinProtected         = NewDomainError(fiber.StatusForbidden, response.CodeBuiltinProtected, "内置资源受保护，不允许该操作")
	ErrSelfOperationDenied      = NewDomainError(fiber.StatusForbidden, response.CodeSelfOperationDenied, "不能对当前登录账号执行该操作")
	ErrUserNotFound             = NewDomainError(fiber.StatusNotFound, response.CodeUserNotFound, "目标用户不存在")
	ErrRoleNotFound             = NewDomainError(fiber.StatusNotFound, response.CodeRoleNotFound, "目标角色不存在")
	ErrResourceConflict         = NewDomainError(fiber.StatusConflict, response.CodeResourceConflict, "资源已存在或唯一性冲突")
	ErrInternalDatabase         = NewDomainError(fiber.StatusInternalServerError, response.CodeDatabaseError, "数据库执行异常")
	ErrAuthorizationUnavailable = NewDomainError(fiber.StatusServiceUnavailable, response.CodeAuthorizationUnavailable, "权限策略暂不可用")
	ErrSessionRevoked           = NewDomainError(fiber.StatusUnauthorized, response.CodeSessionRevoked, "会话已失效，请重新登录")
	ErrPasswordTooWeak          = NewDomainError(fiber.StatusBadRequest, response.CodePasswordTooWeak, "密码强度不足：至少 8 位，且包含大写字母、小写字母、数字、符号中的 3 类")
	ErrDepartmentNotFound       = NewDomainError(fiber.StatusNotFound, response.CodeDepartmentNotFound, "目标部门不存在")
	ErrDepartmentHasChildren    = NewDomainError(fiber.StatusConflict, response.CodeDepartmentHasChildren, "该部门下仍有子部门，请先移除或迁移子部门")
	ErrDepartmentHasMembers     = NewDomainError(fiber.StatusConflict, response.CodeDepartmentHasMembers, "该部门下仍有成员，请先将人员调岗")
	ErrDepartmentInvalidParent  = NewDomainError(fiber.StatusConflict, response.CodeDepartmentInvalidParent, "部门上级设置非法")
	ErrExternalAccountManaged   = NewDomainError(fiber.StatusConflict, response.CodeExternalAccountManaged, "域账号由目录服务管理，不支持该操作")
	ErrPermissionNotFound       = NewDomainError(fiber.StatusNotFound, response.CodePermissionNotFound, "目标权限点不存在")
	ErrPermissionHasChildren    = NewDomainError(fiber.StatusConflict, response.CodePermissionHasChildren, "该权限点下仍有子节点，请先删除子节点")
	ErrDomainNotFound           = NewDomainError(fiber.StatusBadRequest, response.CodeDomainNotFound, "认证域不存在或未启用")
	ErrDomainInvalidCredentials = NewDomainError(fiber.StatusUnauthorized, response.CodeInvalidCredentials, "域认证账号或密码错误")
	ErrDirectoryConfigNotFound  = NewDomainError(fiber.StatusNotFound, response.CodeDirectoryConfigNotFound, "目录配置不存在")
	ErrDirectorySyncNotFound    = NewDomainError(fiber.StatusNotFound, response.CodeDirectorySyncNotFound, "目录同步任务或计划不存在")
	ErrSyncInProgress           = NewDomainError(fiber.StatusConflict, response.CodeSyncInProgress, "该目录正在同步，请稍后再试")
	ErrDirectoryUnavailable     = NewDomainError(fiber.StatusBadGateway, response.CodeDirectoryUnavailable, "目录服务暂不可用，请稍后重试或联系管理员")
)

// GlobalErrorHandler Fiber 全局错误拦截器
func GlobalErrorHandler(c fiber.Ctx, err error) error {
	classified := Classify(err)
	var data any
	if domainErr, ok := errors.AsType[*DomainError](err); ok {
		data = domainErr.Data
	}
	return response.Error(c, classified.HTTPStatus, classified.BizCode, classified.Message, data)
}
