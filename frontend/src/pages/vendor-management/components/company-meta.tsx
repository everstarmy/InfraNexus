import { Building2, Factory, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { CompanyType } from "@/services/vendor-management"

export const COMPANY_MANUFACTURER = 1 as const
export const COMPANY_SUPPLIER = 2 as const
export const COMPANY_BOTH = 3 as const


const CREDIT_ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY"
const CREDIT_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28] as const

export interface CompanyRoleMeta {
  bit: 1 | 2
  key: "manufacturer" | "supplier"
  label: string
  shortLabel: string
  description: string
  icon: typeof Factory
}

export const COMPANY_ROLE_OPTIONS: readonly CompanyRoleMeta[] = [
  {
    bit: COMPANY_MANUFACTURER,
    key: "manufacturer",
    label: "硬件制造商",
    shortLabel: "制造商",
    description: "设备原厂、研发与品牌归属方",
    icon: Factory,
  },
  {
    bit: COMPANY_SUPPLIER,
    key: "supplier",
    label: "供应商 / 服务商",
    shortLabel: "供应商",
    description: "采购渠道、代理供货或维保交付方",
    icon: Truck,
  },
] as const

export const COMPANY_TYPE_FILTER_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: String(COMPANY_MANUFACTURER), label: "制造商" },
  { value: String(COMPANY_SUPPLIER), label: "供应商" },
  { value: String(COMPANY_BOTH), label: "制造商与供应商" },
] as const

export type CompanyTypeFilter = (typeof COMPANY_TYPE_FILTER_OPTIONS)[number]["value"]

export function hasManufacturerRole(type: number): boolean {
  return (type & COMPANY_MANUFACTURER) !== 0
}

export function hasSupplierRole(type: number): boolean {
  return (type & COMPANY_SUPPLIER) !== 0
}

export function toggleCompanyTypeBit(currentType: number, bit: 1 | 2, checked: boolean): number {
  return checked ? currentType | bit : currentType & ~bit
}

export function getCompanyTypeLabel(type: number): string {
  switch (type) {
    case COMPANY_MANUFACTURER:
      return "制造商"
    case COMPANY_SUPPLIER:
      return "供应商"
    case COMPANY_BOTH:
      return "制造商与供应商"
    default:
      return "未知类型"
  }
}

export function normalizeCreditCode(value: string): string {
  return value.trim().toUpperCase()
}

export function validateCreditCode(rawValue: string): string | null {
  const code = normalizeCreditCode(rawValue)
  if (!code) return null
  if (code.length !== 18) {
    return "统一社会信用代码需为 18 位"
  }
  let sum = 0
  for (let i = 0; i < 17; i += 1) {
    const idx = CREDIT_ALPHABET.indexOf(code[i])
    if (idx < 0) {
      return "统一社会信用代码包含非法字符"
    }
    sum += idx * CREDIT_WEIGHTS[i]
  }
  if (CREDIT_ALPHABET.indexOf(code[17]) < 0) {
    return "统一社会信用代码包含非法字符"
  }
  const expected = CREDIT_ALPHABET[(31 - (sum % 31)) % 31]
  if (code[17] !== expected) {
    return "统一社会信用代码校验位无效"
  }
  return null
}

export function isValidHttpUrl(rawValue: string): boolean {
  const value = rawValue.trim()
  if (!value) return true
  if (value.length > 512) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function toSafeExternalUrl(rawValue?: string | null): string | null {
  if (!rawValue) return null
  const value = rawValue.trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
}

export function CompanyTypeBadges({
  type,
  className,
}: {
  type: CompanyType | number
  className?: string
}) {
  const isMfr = hasManufacturerRole(type)
  const isSup = hasSupplierRole(type)

  if (!isMfr && !isSup) {
    return (
      <Badge variant="outline" className={cn("text-xs text-muted-foreground", className)}>
        <Building2 className="size-3" />
        未知
      </Badge>
    )
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {isMfr && (
        <Badge
          variant="secondary"
          className="gap-1 border border-primary/20 bg-primary/10 text-primary"
        >
          <Factory className="size-3" />
          制造商
        </Badge>
      )}
      {isSup && (
        <Badge
          variant="secondary"
          className="gap-1 border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        >
          <Truck className="size-3" />
          供应商
        </Badge>
      )}
    </div>
  )
}
