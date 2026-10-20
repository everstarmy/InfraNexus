import { FolderSync, KeyRound, LayoutDashboard, Network, ShieldCheck, Users, type LucideIcon } from "lucide-react"

export interface NavItem {
  title: string
  url: string
  icon: LucideIcon
  permission: string
  description: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    label: "工作台",
    items: [{ title: "仪表盘", url: "/dashboard", icon: LayoutDashboard, permission: "dashboard", description: "平台运行概览与关键指标" }],
  },
  {
    label: "组织与人员",
    items: [
      { title: "用户管理", url: "/users", icon: Users, permission: "users", description: "人员档案、角色分配与调岗" },
      { title: "部门管理", url: "/departments", icon: Network, permission: "departments", description: "组织架构树与部门成员" },
    ],
  },
  {
    label: "权限中心",
    items: [
      { title: "角色管理", url: "/roles", icon: ShieldCheck, permission: "roles", description: "角色定义与授权范围" },
      { title: "权限清单", url: "/permissions", icon: KeyRound, permission: "permissions", description: "菜单、按钮与 API 权限点" },
    ],
  },
  {
    label: "集成中心",
    items: [{ title: "目录同步", url: "/ldap", icon: FolderSync, permission: "ldap", description: "AD / LDAP 域配置与同步" }],
  },
]

export const navItems = navGroups.flatMap((group) => group.items)

export function findNavByPath(pathname: string) {
  for (const group of navGroups) {
    const item = group.items.find((i) => pathname === i.url || pathname.startsWith(`${i.url}/`))
    if (item) return { group, item }
  }
  return undefined
}
