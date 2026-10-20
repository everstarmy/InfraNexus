package bootstrap

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"infranexus/internal/domain"
)

type permSeed struct {
	Code     string
	Name     string
	Type     domain.PermissionType
	Path     string
	Method   string
	Icon     string
	Children []permSeed
}

const apiPrefix = "/api/v1"

func apiPerm(method, path, name string) permSeed {
	full := apiPrefix + path
	return permSeed{Code: domain.APIPermissionCode(method, full), Name: name, Type: domain.PermTypeAPI, Path: full, Method: method}
}

func buttonPerm(code, name string, apis ...permSeed) permSeed {
	return permSeed{Code: code, Name: name, Type: domain.PermTypeButton, Children: apis}
}

func menuPerm(code, name, path, icon string, children ...permSeed) permSeed {
	return permSeed{Code: code, Name: name, Type: domain.PermTypeMenu, Path: path, Icon: icon, Children: children}
}

var permissionSeeds = []permSeed{
	menuPerm("dashboard", "仪表盘", "/dashboard", "LayoutDashboard",
		apiPerm("GET", "/dashboard/overview", "查看概览指标"),
	),
	menuPerm("org", "组织与人员", "", "Building2",
		menuPerm("users", "用户管理", "/users", "Users",
			apiPerm("GET", "/users", "查询用户列表"),
			apiPerm("GET", "/users/stats", "查看用户统计"),
			apiPerm("GET", "/users/:id", "查看用户详情"),
			buttonPerm("users:create", "新建用户", apiPerm("POST", "/users", "创建用户")),
			buttonPerm("users:update", "编辑用户", apiPerm("PUT", "/users/:id", "更新用户资料")),
			buttonPerm("users:delete", "删除用户", apiPerm("DELETE", "/users/:id", "删除用户")),
			buttonPerm("users:status", "启停用户", apiPerm("PATCH", "/users/:id/status", "切换用户状态")),
			buttonPerm("users:reset-password", "重置密码", apiPerm("POST", "/users/:id/reset-password", "重置用户密码")),
			buttonPerm("users:assign-roles", "分配角色", apiPerm("PUT", "/users/:id/roles", "更新用户角色")),
			buttonPerm("users:move", "人员调岗", apiPerm("POST", "/users/batch-move-department", "批量调整部门")),
		),
		menuPerm("departments", "部门管理", "/departments", "Network",
			apiPerm("GET", "/departments/tree", "查询部门树"),
			apiPerm("GET", "/departments/:id", "查看部门详情"),
			buttonPerm("departments:create", "新建部门", apiPerm("POST", "/departments", "创建部门")),
			buttonPerm("departments:update", "编辑部门",
				apiPerm("PUT", "/departments/:id", "更新部门"),
				apiPerm("POST", "/departments/:id/move", "移动部门"),
				apiPerm("PUT", "/departments/reorder", "调整部门排序"),
			),
			buttonPerm("departments:delete", "删除部门", apiPerm("DELETE", "/departments/:id", "删除部门")),
		),
	),
	menuPerm("access", "权限中心", "", "ShieldCheck",
		menuPerm("roles", "角色管理", "/roles", "ShieldCheck",
			apiPerm("GET", "/roles", "查询角色列表"),
			apiPerm("GET", "/roles/:id", "查看角色详情"),
			buttonPerm("roles:create", "新建角色", apiPerm("POST", "/roles", "创建角色")),
			buttonPerm("roles:update", "编辑角色", apiPerm("PUT", "/roles/:id", "更新角色")),
			buttonPerm("roles:delete", "删除角色", apiPerm("DELETE", "/roles/:id", "删除角色")),
			buttonPerm("roles:assign", "分配权限",
				apiPerm("GET", "/roles/permission-tree", "读取可分配权限树"),
				apiPerm("POST", "/roles/:id/permissions", "分配角色权限"),
			),
		),
		menuPerm("permissions", "权限清单", "/permissions", "KeyRound",
			apiPerm("GET", "/permissions", "查询权限树"),
			buttonPerm("permissions:create", "新建权限点", apiPerm("POST", "/permissions", "创建权限点")),
			buttonPerm("permissions:update", "编辑权限点", apiPerm("PUT", "/permissions/:id", "更新权限点")),
			buttonPerm("permissions:delete", "删除权限点", apiPerm("DELETE", "/permissions/:id", "删除权限点")),
			buttonPerm("permissions:sync", "同步路由", apiPerm("POST", "/permissions/sync", "同步路由至 Casbin")),
		),
	),
	menuPerm("integration", "集成中心", "", "Plug",
		menuPerm("ldap", "目录同步", "/ldap", "FolderSync",
			apiPerm("GET", "/ldap/configs", "查询目录配置"),
			apiPerm("GET", "/ldap/configs/:id", "查看目录配置"),
			apiPerm("GET", "/ldap/sync-logs", "查看同步日志"),
			buttonPerm("ldap:create", "新建目录配置", apiPerm("POST", "/ldap/configs", "创建目录配置")),
			buttonPerm("ldap:update", "编辑目录配置", apiPerm("PUT", "/ldap/configs/:id", "更新目录配置")),
			buttonPerm("ldap:delete", "删除目录配置", apiPerm("DELETE", "/ldap/configs/:id", "删除目录配置")),
			buttonPerm("ldap:test", "测试连接", apiPerm("POST", "/ldap/test", "测试目录连接")),
			buttonPerm("ldap:sync", "执行同步",
				apiPerm("POST", "/ldap/preview", "预览同步计划"),
				apiPerm("POST", "/ldap/sync", "执行目录同步"),
			),
		),
	),
}

func seedPermissions(tx *gorm.DB) error {
	return upsertPermissionSeeds(tx, nil, permissionSeeds)
}

func upsertPermissionSeeds(tx *gorm.DB, parentID *uuid.UUID, seeds []permSeed) error {
	for i, seed := range seeds {
		var perm domain.Permission
		err := tx.First(&perm, "code = ?", seed.Code).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			perm = domain.Permission{
				ParentID:  parentID,
				Code:      seed.Code,
				Name:      seed.Name,
				Type:      seed.Type,
				Path:      seed.Path,
				Method:    seed.Method,
				Icon:      seed.Icon,
				SortOrder: i + 1,
				BuiltIn:   true,
			}
			if err := tx.Create(&perm).Error; err != nil {
				return fmt.Errorf("seed permission %s: %w", seed.Code, err)
			}
		case err != nil:
			return fmt.Errorf("load permission %s: %w", seed.Code, err)
		default:
			locked := map[string]any{
				"parent_id": parentID,
				"type":      seed.Type,
				"path":      seed.Path,
				"method":    seed.Method,
				"built_in":  true,
			}
			if err := tx.Model(&perm).Updates(locked).Error; err != nil {
				return fmt.Errorf("refresh permission %s: %w", seed.Code, err)
			}
		}
		if err := upsertPermissionSeeds(tx, &perm.ID, seed.Children); err != nil {
			return err
		}
	}
	return nil
}
