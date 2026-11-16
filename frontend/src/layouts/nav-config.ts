import {
  Archive,
  Boxes,
  Building2,
  ClipboardCheck,
  Cpu,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Network,
  PackageCheck,
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
        url: "/locations/topology",
        icon: MapPin,
        permission: "locations",
        description: "数据中心园区、机房空间拓扑与仓储库位",
        children: [
          {
            title: "空间拓扑与机柜",
            url: "/locations/topology",
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
      },
      {
        title: "制造商与供应商",
        url: "/vendor-management",
        icon: Building2,
        permission: "vendor-management",
        description: "硬件制造商、供应商及联系人档案",
      },
    ],
  },
  {
    label: "硬件模型与资产",
    items: [
      {
        title: "型号管理",
        url: "/model-management/device-models",
        icon: Boxes,
        permission: "model-management",
        description: "组件与设备型号目录及发布版本",
        children: [
          {
            title: "组件型号",
            url: "/model-management/component-models",
            icon: Cpu,
            permission: "model-management:component-models",
            description: "CPU、内存、硬盘等组件型号规格与版本管理",
          },
          {
            title: "设备型号",
            url: "/model-management/device-models",
            icon: Server,
            permission: "model-management:device-models",
            description: "服务器、存储与网络设备型号、槽位端口及兼容清单",
          },
        ],
      },
      {
        title: "到货单",
        url: "/arrival-orders",
        icon: PackageCheck,
        permission: "arrival-orders",
        description: "采购到货计划、每台计划配置与收货进度",
      },
      {
        title: "到货验收",
        url: "/receipts",
        icon: ClipboardCheck,
        permission: "receipts",
        description: "分批收货核验、图片凭证、预检与入库确认",
      },
      {
        title: "实物资产",
        url: "/assets/devices",
        icon: HardDrive,
        permission: "assets",
        description: "已建账设备与逐件组件实物台账",
        children: [
          {
            title: "设备资产",
            url: "/assets/devices",
            icon: HardDrive,
            permission: "assets:devices",
            description: "设备实物台账、到货基线、当前配置与差异对比",
          },
          {
            title: "组件资产",
            url: "/assets/components",
            icon: Cpu,
            permission: "assets:components",
            description: "逐件组件台账、来源/当前设备关系与序列号补录",
          },
        ],
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
  const cleanPath = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  const normalizedPath = cleanPath === "/locations" ? "/locations/topology" : cleanPath

  // 1. Exact child match
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.children) {
        const exactChild = item.children.find((c) => normalizedPath === c.url)
        if (exactChild) {
          return { group, item: exactChild, parent: item }
        }
      }
    }
  }

  // 2. Exact parent/top-level match
  for (const group of navGroups) {
    for (const item of group.items) {
      if (normalizedPath === item.url) {
        return { group, item }
      }
    }
  }

  // 3. Longest prefix child match
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.children) {
        const matchingChild = [...item.children]
          .filter((c) => normalizedPath.startsWith(`${c.url}/`))
          .sort((a, b) => b.url.length - a.url.length)[0]
        if (matchingChild) {
          return { group, item: matchingChild, parent: item }
        }
      }
    }
  }

  // 4. Longest prefix top-level match
  for (const group of navGroups) {
    for (const item of group.items) {
      if (normalizedPath.startsWith(`${item.url}/`)) {
        return { group, item }
      }
    }
  }

  return undefined
}
