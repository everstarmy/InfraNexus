import { useEffect, useState } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, FileSearch, RefreshCw, Send } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getErrorMessage,
  isNetworkOrUnknownError,
  isVersionConflict,
  type ReceiptIssueDTO,
} from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { createIdempotencyKey } from "@/services/receiving-metadata"
import { receiptsService, type ReceiptPreviewDTO } from "@/services/receipts"

export function ReceiptPreviewPanel({
  receiptId,
  receiptVersion,
  canComplete,
  onLocateIssue,
  onCompleted,
  onVersionConflict,
  onQueryLatestState,
}: {
  receiptId: string
  receiptVersion: number
  canComplete: boolean
  onLocateIssue: (issue: ReceiptIssueDTO) => void
  onCompleted: () => void
  onVersionConflict: (err: unknown) => void
  onQueryLatestState: () => Promise<void>
}) {
  const [previewing, setPreviewing] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [previewData, setPreviewData] = useState<ReceiptPreviewDTO | null>(null)
  const [pendingCommit, setPendingCommit] = useState<{
    key: string
    expectedVersion: number
    errorMessage: string
  } | null>(null)

  useEffect(() => {
    // Clear stale precheck summary when receipt version advances.
    if (previewData && previewData.checked_version !== receiptVersion) {
      setPreviewData(null)
    }
    setPendingCommit(null)
  }, [receiptVersion, previewData])

  const runPreview = async () => {
    setPreviewing(true)
    try {
      const res = await receiptsService.preview(receiptId)
      setPreviewData(res.data)
      if (res.data.can_complete) {
        notify.success("预检通过，可确认完成整单验收")
      } else {
        notify.warning(`预检发现 ${res.data.errors.length} 项阻塞问题，请点击定位修复`)
      }
    } catch (err) {
      notify.error(getErrorMessage(err, "执行预检失败"))
    } finally {
      setPreviewing(false)
    }
  }

  const executeComplete = async (key: string, expectedVersion: number) => {
    setCompleting(true)
    try {
      const res = await receiptsService.complete(receiptId, expectedVersion, key)
      setPendingCommit(null)
      notify.success(
        `验收完成：生成 ${res.data.accepted_device_count} 台设备与 ${res.data.created_part_count} 件组件资产`,
      )
      onCompleted()
    } catch (err) {
      if (isVersionConflict(err)) {
        setPendingCommit(null)
        onVersionConflict(err)
        return
      }
      if (isNetworkOrUnknownError(err)) {
        setPendingCommit({
          key,
          expectedVersion,
          errorMessage: getErrorMessage(err, "请求超时或服务端状态未知"),
        })
        notify.warning("提交响应超时或网络异常，已保留同一幂等键，可先查询结果或安全重试")
        return
      }
      setPendingCommit(null)
      notify.error(getErrorMessage(err, "提交验收失败，请先执行预检排查"))
    } finally {
      setCompleting(false)
    }
  }

  if (!canComplete) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">提交预检与整单确认</CardTitle>
            <CardDescription className="text-xs">
              提交前先校验每台设备序列号、图片凭证、数量差异原因及组件安装关系；组件序列号为空时会给出可提交提示。
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={previewing} onClick={runPreview}>
              <FileSearch className="mr-1.5 size-4" />
              {previewing ? "预检中..." : "执行预检"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={completing || (previewData !== null && !previewData.can_complete)}
              onClick={() => executeComplete(createIdempotencyKey("complete"), receiptVersion)}
            >
              <Send className="mr-1.5 size-4" />
              {completing ? "提交入库中..." : "完成整单验收"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {pendingCommit && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle className="text-sm">提交结果待确认（网络/超时保护）</AlertTitle>
            <AlertDescription className="mt-1 space-y-2 text-xs">
              <p>
                {pendingCommit.errorMessage}。为避免重复生成资产，请勿新建另一张验收单；可先查询当前提交结果或使用原幂等键重试。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={onQueryLatestState}>
                  <RefreshCw className="mr-1.5 size-3.5" />
                  查询当前提交结果
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={completing}
                  onClick={() => executeComplete(pendingCommit.key, pendingCommit.expectedVersion)}
                >
                  使用同一幂等键安全重试
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {previewData && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-xs">
              <Badge variant={previewData.can_complete ? "default" : "destructive"}>
                {previewData.can_complete ? "预检通过 · 允许提交" : "预检未通过"}
              </Badge>
              <span>预计通过设备：{previewData.summary.accepted_device_count} 台</span>
              <span>拒收设备：{previewData.summary.rejected_device_count} 台</span>
              <span>预计生成组件资产：{previewData.summary.created_part_count} 件</span>
            </div>

            {previewData.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertCircle className="size-4" />
                  阻塞错误 ({previewData.errors.length}) — 点击任意条目直接定位修复
                </div>
                <div className="space-y-1.5">
                  {previewData.errors.map((issue, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="w-full text-left rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs hover:bg-destructive/10 transition-colors flex items-center justify-between gap-2"
                      onClick={() => onLocateIssue(issue)}
                    >
                      <span>
                        <span className="font-mono text-[11px] text-muted-foreground mr-2">[{issue.field}]</span>
                        {issue.message}
                      </span>
                      <span className="text-[11px] font-medium text-destructive shrink-0">点击定位 →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {previewData.warnings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-4" />
                  提示信息 ({previewData.warnings.length}) — 不阻塞提交，可在资产生成后逐件补录组件序列号
                </div>
                <div className="space-y-1.5">
                  {previewData.warnings.map((issue, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="w-full text-left rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors flex items-center justify-between gap-2"
                      onClick={() => onLocateIssue(issue)}
                    >
                      <span>
                        <span className="font-mono text-[11px] text-muted-foreground mr-2">[{issue.field}]</span>
                        {issue.message}
                      </span>
                      <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
                        定位条目 →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {previewData.can_complete && previewData.errors.length === 0 && previewData.warnings.length === 0 && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-4" />
                全部台次、照片及组件序列号校验无误，可直接点击「完成整单验收」。
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
