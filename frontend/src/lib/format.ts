import { format, formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"

export function formatDateTime(value?: string | null, pattern = "yyyy-MM-dd HH:mm") {
  if (!value) return "—"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 2000) return "—"
  return format(date, pattern)
}

export function formatRelative(value?: string | null) {
  if (!value) return "从未"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 2000) return "从未"
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value)
}

export function formatCompact(value: number) {
  if (Math.abs(value) < 10000) return formatNumber(value)
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function formatPercent(part: number, total: number) {
  if (!total) return "0%"
  return `${Math.round((part / total) * 100)}%`
}
