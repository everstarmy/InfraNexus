import type { UserListParams } from "@/services/users"
import type { RoleListParams } from "@/services/roles"

export const queryKeys = {
  users: (params: UserListParams) => ["users", "list", params] as const,
  usersAll: ["users"] as const,
  userStats: ["users", "stats"] as const,
  departmentTree: ["departments", "tree"] as const,
  roleOptions: ["options", "roles"] as const,
  departmentOptions: ["options", "departments"] as const,
  roles: (params: RoleListParams) => ["roles", "list", params] as const,
  rolesAll: ["roles"] as const,
  permissions: ["permissions"] as const,
  ldapConfigs: ["ldap", "configs"] as const,
  ldapLogs: (configId?: string) => ["ldap", "logs", configId ?? "all"] as const,
  loginDomains: ["auth", "domains"] as const,
  dashboard: ["dashboard"] as const,
}
