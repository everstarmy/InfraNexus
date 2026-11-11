import {
  Archive,
  Building2,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Network,
  Server,
  ShieldCheck,
  Users,
  Waypoints,
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
    label: "基础设施与资源 (DCIM)",
    items: [
      {
        title: "位置管理",
        url: "/locations",
        icon: MapPin,
        permission: "locations",
        description: "数据中心园区、机房空间拓扑与仓储库位",
        children: [
          {
            title: "空间拓扑与机柜",
            url: "/locations",
            icon: MapPin,
            permission: "locations",
            description: "数据中心、楼层机房树与机柜 U 位立面图",
          },
          {
            title: "备件仓储与暂存",
            url: "/locations/warehouses",
            icon: Archive,
            permission: "locations",
            description: "备件库房、货架库位及下线设备周转点",
          },
        ],
      },
      {
        title: "IP 管理",
        url: "/ipam/subnets",
        icon: Network,
        permission: "ipam",
        description: "VRF 空间、子网 CIDR 与 IP 地址池生命周期",
        children: [
          {
            title: "子网与地址池",
            url: "/ipam/subnets",
            icon: Network,
            permission: "ipam",
            description: "CIDR 划分、地址矩阵 5 态生命周期与冲突处置",
          },
          {
            title: "机柜网段绑定",
            url: "/ipam/rack-bindings",
            icon: Server,
            permission: "ipam",
            description: "机柜与子网默认推荐绑定映射",
          },
        ],
      },
      {
        title: "制造商与供应商",
        url: "/vendor-management",
        icon: Building2,
        permission: "vendor-management",
        description: "原厂设备制造商标准档案、第三方维保供应商资质与 SLA",
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
        title: "身份源集成",
        url: "/ldap",
        icon: Waypoints,
        permission: "ldap",
        description: "AD / LDAP 企业身份源与组织同步",
      },
    ],
  },
]

export const navItems = navGroups.flatMap((group) =>
  group.items.flatMap((item) => (item.children ? [item, ...item.children] : [item]))
)

export const pageNavItems = navGroups.flatMap((group) =>
  group.items.flatMap((item) => item.children ?? [item])
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
