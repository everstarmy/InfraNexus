import {
  Building2,
  FolderSync,
  KeyRound,
  LayoutDashboard,
  Network,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  title: string
  url: string
  icon: LucideIcon
  permission: string
  description: string
  children?: NavItem[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    label: "工作台",
    items: [
      {
        title: "仪表盘",
        url: "/dashboard",
        icon: LayoutDashboard,
        permission: "dashboard",
        description: "平台运行概览与关键指标",
      },
    ],
  },
  {
    label: "访问控制与组织",
    items: [
      {
        title: "组织架构",
        url: "/users",
        icon: Building2,
        permission: "org",
        description: "人员档案、角色分配与部门树",
        children: [
          {
            title: "用户管理",
            url: "/users",
            icon: Users,
            permission: "users",
            description: "人员档案、角色分配与调岗",
          },
          {
            title: "部门管理",
            url: "/departments",
            icon: Network,
            permission: "departments",
            description: "组织架构树与部门成员",
          },
        ],
      },
      {
        title: "权限中心",
        url: "/roles",
        icon: ShieldCheck,
        permission: "access",
        description: "角色定义、权限分配与授权矩阵",
        children: [
          {
            title: "角色管理",
            url: "/roles",
            icon: ShieldCheck,
            permission: "roles",
            description: "角色定义与授权范围",
          },
          {
            title: "权限清单",
            url: "/permissions",
            icon: KeyRound,
            permission: "permissions",
            description: "菜单、按钮与 API 权限点",
          },
        ],
      },
    ],
  },
  {
    label: "系统配置",
    items: [
      {
        title: "目录同步",
        url: "/ldap",
        icon: FolderSync,
        permission: "ldap",
        description: "AD / LDAP 域配置与同步",
      },
    ],
  },
]

export const navItems = navGroups.flatMap((group) =>
  group.items.flatMap((item) => (item.children ? [item, ...item.children] : [item]))
)

export function findNavByPath(pathname: string) {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.children) {
        const child = item.children.find(
          (c) => pathname === c.url || pathname.startsWith(`${c.url}/`)
        )
        if (child) {
          return { group, item: child, parent: item }
        }
      }
      if (pathname === item.url || pathname.startsWith(`${item.url}/`)) {
        return { group, item }
      }
    }
  }
  return undefined
}
