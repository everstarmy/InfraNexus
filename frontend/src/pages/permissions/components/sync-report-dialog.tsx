import { CheckCircle2, RefreshCcwDot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MethodBadge } from "@/components/common/badges"
import type { RouteSyncReport } from "@/services/permissions"

export function SyncReportDialog({ report, onOpenChange }: { report: RouteSyncReport | null; onOpenChange: (open: boolean) => void }) {
  const metrics = report
    ? [
        { label: "扫描路由", value: report.discovered },
        { label: "新增权限点", value: report.created },
        { label: "已登记", value: report.existing },
        { label: "策略新增", value: report.policies_added },
        { label: "策略移除", value: report.policies_removed },
      ]
    : []
  return (
    <Dialog open={!!report} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCcwDot className="size-4.5 text-primary" />
            路由同步报告
          </DialogTitle>
          <DialogDescription>已扫描服务端注册的受控路由，补齐 API 权限点，并按角色授权重建 Casbin 策略</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-5 gap-px overflow-hidden rounded-xl border bg-border">
          {metrics.map((m) => (
            <div key={m.label} className="bg-card px-2 py-3 text-center">
              <dd className="text-xl font-semibold">{m.value}</dd>
              <dt className="mt-0.5 text-[11px] text-muted-foreground">{m.label}</dt>
            </div>
          ))}
        </dl>
        {report && report.created_routes.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">新登记的接口（已归入对应模块或「未归类接口」）</p>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
              {report.created_routes.map((r) => (
                <li key={`${r.method} ${r.path}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                  <MethodBadge method={r.method} />
                  <code className="truncate font-mono text-xs">{r.path}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" />
            所有受控路由均已登记，权限点与 Casbin 策略保持一致
          </p>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
