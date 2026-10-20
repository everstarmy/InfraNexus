package response

import (
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
)

// BusinessCode 领域业务状态码
type BusinessCode int

const (
	CodeSuccess                 BusinessCode = 200000 // 成功
	CodeParamInvalid            BusinessCode = 400001 // 请求参数错误
	CodePasswordTooWeak         BusinessCode = 400002 // 密码强度不足
	CodeTokenExpired            BusinessCode = 401001 // 会话或Token过期
	CodeInvalidCredentials      BusinessCode = 401002 // 账号或密码错误
	CodeSessionRevoked          BusinessCode = 401003 // 会话已被注销
	CodePermissionDenied        BusinessCode = 403001 // 权限不足 (Casbin拦截)
	CodeAccountDisabled         BusinessCode = 403002 // 账号已被禁用
	CodeBuiltinProtected        BusinessCode = 403003 // 内置资源受保护
	CodeSelfOperationDenied     BusinessCode = 403004 // 不能对当前登录账号执行该操作
	CodeUserNotFound            BusinessCode = 404001 // 用户未找到
	CodeRoleNotFound            BusinessCode = 404002 // 角色未找到
	CodeDepartmentNotFound      BusinessCode = 404003 // 部门未找到
	CodeResourceConflict        BusinessCode = 409001 // 唯一约束冲突
	CodeDepartmentHasChildren   BusinessCode = 409002 // 部门下仍有子部门
	CodeDepartmentHasMembers    BusinessCode = 409003 // 部门下仍有成员
	CodeDepartmentInvalidParent BusinessCode = 409004 // 部门上级非法（成环/层级超限/已停用）
	CodeExternalAccountManaged  BusinessCode = 409007 // 域账号由目录服务管理
	CodeRateLimited             BusinessCode = 429001 // 请求过于频繁
	CodeDatabaseError           BusinessCode = 500001 // 数据库异常
	CodeInternalError           BusinessCode = 500002 // 系统未知故障
)

// Envelope 统一泛型响应外壳 (Go 1.27+)
type Envelope[T any] struct {
	Code      BusinessCode `json:"code"`
	Message   string       `json:"message"`
	Data      T            `json:"data"`
	RequestID string       `json:"request_id"`
	Timestamp int64        `json:"timestamp"`
}

// PageData 泛型分页数据结构
type PageData[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}

// Success 成功响应
func Success[T any](c fiber.Ctx, data T) error {
	reqID := getRequestID(c)
	return c.Status(fiber.StatusOK).JSON(Envelope[T]{
		Code:      CodeSuccess,
		Message:   "success",
		Data:      data,
		RequestID: reqID,
		Timestamp: time.Now().Unix(),
	})
}

// Page 分页列表成功响应
func Page[T any](c fiber.Ctx, items []T, total int64, page, pageSize int) error {
	reqID := getRequestID(c)
	return c.Status(fiber.StatusOK).JSON(Envelope[PageData[T]]{
		Code:    CodeSuccess,
		Message: "success",
		Data: PageData[T]{
			Items:    items,
			Total:    total,
			Page:     page,
			PageSize: pageSize,
		},
		RequestID: reqID,
		Timestamp: time.Now().Unix(),
	})
}

// Error 业务错误响应
func Error(c fiber.Ctx, httpStatus int, bizCode BusinessCode, message string, extra ...any) error {
	reqID := getRequestID(c)
	var data any
	if len(extra) > 0 {
		data = extra[0]
	}
	return c.Status(httpStatus).JSON(Envelope[any]{
		Code:      bizCode,
		Message:   message,
		Data:      data,
		RequestID: reqID,
		Timestamp: time.Now().Unix(),
	})
}

func getRequestID(c fiber.Ctx) string {
	if c == nil {
		return ""
	}
	return requestid.FromContext(c)
}
