import { AlertTriangle, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export interface VersionConflictState {
  message: string
  currentVersion?: number
  localSummary?: string
}

export function VersionConflictAlert({
  conflict,
  onReload,
  onDismiss,
  reloading,
}: {
  conflict: VersionConflictState | null
  onReload: () => void
  onDismiss?: () => void
  reloading?: boolean
}) {
  if (!conflict) return null

  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
      <AlertTriangle className="size-4" />
      <AlertTitle className="text-sm font-medium">
        版本冲突（服务端当前版本 {conflict.currentVersion ? `v${conflict.currentVersion}` : "已更新"}）
      </AlertTitle>
      <AlertDescription className="mt-1 space-y-2 text-xs">
        <p>
          {conflict.message}。系统已保留您当前页面尚未保存的输入内容，请先重新加载最新数据核对差异后再确认提交，避免直接覆盖他人修改。
        </p>
        {conflict.localSummary && (
          <p className="rounded border border-destructive/20 bg-background/80 px-2.5 py-1.5 text-muted-foreground">
            已保留本地草稿：{conflict.localSummary}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" size="sm" variant="destructive" disabled={reloading} onClick={onReload}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {reloading ? "重新加载中..." : "重新加载最新状态"}
          </Button>
          {onDismiss && (
            <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
              暂留当前编辑
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
