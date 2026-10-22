import { LockKeyhole, RefreshCw, WifiOff } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { getErrorStatus } from "@/lib/api-error"

export function isForbiddenQueryError(error: unknown) {
  return getErrorStatus(error) === 403
}

export function QueryPlaceholderNotice({ label = "数据" }: { label?: string }) {
  return (
    <Alert role="status" aria-live="polite" className="border-sky-500/25 bg-sky-500/5 text-foreground">
      <RefreshCw className="text-sky-600 dark:text-sky-300" />
      <AlertTitle>正在加载当前{label}</AlertTitle>
      <AlertDescription>暂时显示上次读取的结果；当前筛选加载完成前，依赖这组数据的操作已暂停。</AlertDescription>
    </Alert>
  )
}

export function QueryErrorState({ error, onRetry, label = "数据", retrying = false }: {
  error: unknown
  onRetry: () => void
  label?: string
  retrying?: boolean
}) {
  const forbidden = isForbiddenQueryError(error)
  const Icon = forbidden ? LockKeyhole : WifiOff
  return (
    <Alert variant="destructive" role="alert">
      <Icon />
      <AlertTitle>{forbidden ? "没有查看权限" : `${label}暂时无法加载`}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{forbidden ? "请联系管理员为当前角色授予所需权限。" : "请检查网络或稍后重试；已有数据显示为最近一次成功结果。"}</span>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? "motion-safe:animate-spin" : ""} />
          重试
        </Button>
      </AlertDescription>
    </Alert>
  )
}
