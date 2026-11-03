import { Circle, CircleCheck, CircleX, LoaderCircle, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SyncStatus } from "@/services/ldap"

const meta: Record<SyncStatus, { label: string; icon: typeof Circle; className: string }> = {
  idle: { label: "未同步", icon: Circle, className: "border-border text-muted-foreground" },
  running: { label: "同步中", icon: LoaderCircle, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  success: { label: "成功", icon: CircleCheck, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  partial: { label: "部分失败", icon: TriangleAlert, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  failed: { label: "失败", icon: CircleX, className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
}

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const m = meta[status] ?? meta.idle
  const Icon = m.icon
  return (
    <Badge variant="outline" className={cn("gap-1", m.className)}>
      <Icon className={cn(status === "running" && "animate-spin")} />
      {m.label}
    </Badge>
  )
}
