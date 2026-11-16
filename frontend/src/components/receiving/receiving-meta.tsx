import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { queryKeys } from "@/lib/query-keys"
import {
  receivingMetadataService,
  type AssetSpec,
  type SpecSchemaFieldDTO,
} from "@/services/receiving-metadata"
import { companiesService } from "@/services/vendor-management"

export function useReceivingMetadata(enabled = true) {
  return useQuery({
    queryKey: queryKeys.receivingMetadata,
    queryFn: ({ signal }) => receivingMetadataService.get(signal),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCompanyOptions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.companies({ page: 1, page_size: 100, status: 1 }),
    queryFn: ({ signal }) => companiesService.list({ page: 1, page_size: 100, status: 1 }, signal),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function filterManufacturers<T extends { type: number }>(companies: T[]): T[] {
  return companies.filter((c) => c.type === 1 || c.type === 3)
}

export function filterSuppliers<T extends { type: number }>(companies: T[]): T[] {
  return companies.filter((c) => c.type === 2 || c.type === 3)
}

export function hasAllowedAction(
  allowedActions: string[] | undefined,
  action: string,
  hasPermission: boolean,
): boolean {
  return hasPermission && Boolean(allowedActions?.includes(action))
}

export const COMPONENT_KIND_LABELS: Record<string, string> = {
  cpu: "处理器 (CPU)",
  memory: "内存 (Memory)",
  disk: "硬盘 (Disk)",
  nic: "网卡 (NIC)",
  hba: "HBA 卡",
  power_supply: "电源 (PSU)",
  fan: "风扇 (Fan)",
  controller: "控制器 / 阵列卡",
  optical_module: "光模块",
  other: "其他组件",
}

export const DEVICE_CATEGORY_LABELS: Record<string, string> = {
  server: "服务器",
  storage: "存储设备",
  fc_switch: "光纤交换机 (FC)",
  network_switch: "网络交换机",
  other: "其他设备",
}

export const MOUNTING_TYPE_LABELS: Record<string, string> = {
  rack: "机架式 (Rack)",
  blade: "刀片式 (Blade)",
  standalone: "独立式 (Standalone)",
}

export const SPEC_FIELD_LABELS: Record<string, string> = {
  schema_version: "规范版本",
  capacity_bytes: "容量 (Bytes)",
  memory_generation: "内存代数",
  speed_mt_s: "速率 (MT/s)",
  ecc: "ECC 校验",
  interface: "接口类型",
  media_type: "介质类型",
  form_factor: "物理规格 / 尺寸",
  socket: "插槽接口 (Socket)",
  cores: "核心数",
  threads: "线程数",
  base_frequency_mhz: "基础频率 (MHz)",
  protocol: "协议",
  port_count: "端口数量",
  speed_mbps: "速率 (Mbps)",
  rated_power_w: "额定功率 (W)",
  input_type: "输入类型",
  cache_bytes: "缓存容量 (Bytes)",
  has_nonvolatile_cache: "掉电保护缓存",
  connector: "接口连接器",
  wavelength_nm: "波长 (nm)",
  width_mm: "宽度 (mm)",
  depth_mm: "深度 (mm)",
  weight_kg: "重量 (kg)",
  description: "补充规格说明",
}

export function labelComponentKind(kind?: string): string {
  if (!kind) return "—"
  return COMPONENT_KIND_LABELS[kind] ?? kind
}

export function labelDeviceCategory(category?: string): string {
  if (!category) return "—"
  return DEVICE_CATEGORY_LABELS[category] ?? category
}

export function labelSpecField(field: SpecSchemaFieldDTO): string {
  const base = SPEC_FIELD_LABELS[field.name] ?? field.name
  return field.unit && !base.includes(field.unit) ? `${base} (${field.unit})` : base
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return "—"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx++
  }
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2)
  return `${formatted} ${units[idx]} (${bytes.toLocaleString("zh-CN")} B)`
}

export function formatSpecSummary(spec?: AssetSpec | null): string {
  if (!spec) return "—"
  const parts: string[] = []
  if (spec.memory_generation) parts.push(spec.memory_generation)
  if (typeof spec.capacity_bytes === "number") parts.push(formatBytes(spec.capacity_bytes).split(" (")[0])
  if (typeof spec.speed_mt_s === "number") parts.push(`${spec.speed_mt_s} MT/s`)
  if (spec.media_type) parts.push(spec.media_type)
  if (spec.interface) parts.push(spec.interface)
  if (typeof spec.cores === "number") parts.push(`${spec.cores}C`)
  if (typeof spec.threads === "number") parts.push(`${spec.threads}T`)
  if (typeof spec.port_count === "number") parts.push(`${spec.port_count} 口`)
  if (typeof spec.speed_mbps === "number") parts.push(`${spec.speed_mbps} Mbps`)
  if (typeof spec.rated_power_w === "number") parts.push(`${spec.rated_power_w} W`)
  if (parts.length > 0) return parts.join(" · ")
  if (spec.description) return spec.description
  return "标准规格"
}

export const STATE_BADGE_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  // Model status
  "1": { label: "启用", variant: "default" },
  "2": { label: "停用", variant: "secondary" },
  // Revision state
  draft: { label: "草稿", variant: "outline" },
  published: { label: "已发布", variant: "default" },
  // Arrival order states
  open: { label: "收货中", variant: "default" },
  completed: { label: "已完成", variant: "secondary" },
  closed: { label: "已关闭", variant: "secondary" },
  canceled: { label: "已取消", variant: "destructive" },
  // Inspection result
  pending: { label: "待检", variant: "outline" },
  pass: { label: "通过", variant: "default" },
  reject: { label: "拒收", variant: "destructive" },
  // Compatibility
  confirmed: { label: "已确认兼容", variant: "default" },
  incompatible: { label: "不兼容", variant: "destructive" },
  // Placement
  installed: { label: "已安装", variant: "default" },
  stored: { label: "库房暂存", variant: "secondary" },
  // Lifecycle / quality
  receiving: { label: "入库/待上架", variant: "secondary" },
  in_stock: { label: "在库", variant: "secondary" },
  in_service: { label: "服役中", variant: "default" },
  good: { label: "良品", variant: "default" },
  defective: { label: "故障", variant: "destructive" },
  // Diff change
  added: { label: "新增", variant: "default" },
  removed: { label: "移除", variant: "destructive" },
  moved: { label: "槽位变更", variant: "secondary" },
  unchanged: { label: "一致", variant: "outline" },
}

export function AssetStatusBadge({ state, customLabel }: { state: string | number; customLabel?: string }) {
  const key = String(state)
  const meta = STATE_BADGE_MAP[key] ?? { label: key || "—", variant: "outline" as const }
  return (
    <Badge variant={meta.variant} className="font-normal whitespace-nowrap">
      {customLabel ?? meta.label}
    </Badge>
  )
}
