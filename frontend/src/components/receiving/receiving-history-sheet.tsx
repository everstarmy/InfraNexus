import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Clock, History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { formatDateTime } from "@/lib/format"
import type { AssetActionDTO } from "@/services/receiving-metadata"
import type { Envelope, PageData } from "@/services/types"

const ACTION_KIND_LABELS: Record<string, string> = {
  "model.component.create": "新建组件型号",
  "model.component.update": "更新组件型号",
  "model.component.status": "变更型号状态",
  "model.component.revisions.create": "创建型号版本",
  "model.component.revisions.update": "编辑型号草稿",
  "model.component.revisions.publish": "发布型号版本",
  "model.device.create": "新建设备型号",
  "model.device.update": "更新设备型号",
  "model.device.status": "变更型号状态",
  "model.device.revisions.create": "创建型号版本",
  "model.device.revisions.update": "编辑型号草稿",
  "model.device.revisions.publish": "发布型号版本",
  "order.create": "新建到货单",
  "order.update": "更新到货单",
  "order.lines.create": "添加计划明细",
  "order.lines.update": "更新计划配置",
  "order.lines.delete": "删除计划明细",
  "order.open": "开放收货",
  "order.close": "关闭到货单",
  "order.cancel": "取消到货单",
  "receipt.create": "创建验收单",
  "receipt.update": "更新验收单",
  "receipt.complete": "完成整单验收",
  "receipt.cancel": "取消验收单",
  "asset.components.serial": "补录组件序列号",
}

function summarizePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "—"
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

export function ReceivingHistorySheet({
  open,
  onOpenChange,
  title,
  recordLabel,
  recordId,
  queryKey,
  fetchHistory,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  recordLabel?: string
  recordId?: string | null
  queryKey: (page: number) => readonly unknown[]
  fetchHistory: (id: string, params: { page: number; page_size: number }, signal?: AbortSignal) => Promise<Envelope<PageData<AssetActionDTO>>>
}) {
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: queryKey(page),
    queryFn: ({ signal }) => fetchHistory(recordId!, { page, page_size: 20 }, signal),
    enabled: open && Boolean(recordId),
  })

  const items = query.data?.data.items ?? []
  const total = query.data?.data.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-lg p-0">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <History className="size-4.5 text-primary" />
            <SheetTitle className="text-base font-semibold">操作历史</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            {title} {recordLabel ? `「${recordLabel}」` : ""} 的资产操作与变更轨迹
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {query.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : query.error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
              加载操作历史失败，请稍后重试。
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-xs text-muted-foreground">
              <Clock className="mb-2 size-6 opacity-30" />
              暂无操作记录
            </div>
          ) : (
            <div className="relative border-l border-border/60 pl-4 space-y-5 my-2">
              {items.map((action) => {
                const isExpanded = expandedId === action.id
                return (
                  <div key={action.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border border-background bg-primary ring-2 ring-background" />
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {ACTION_KIND_LABELS[action.kind] ?? action.kind}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateTime(action.created_at, "yyyy-MM-dd HH:mm:ss")}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">Req: {action.request_id || "—"}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setExpandedId(isExpanded ? null : action.id)}
                        >
                          {isExpanded ? "收起快照" : "查看前后数据"}
                        </Button>
                      </div>
                      {isExpanded && (
                        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-2.5 text-[11px]">
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">变更前 (Before)</div>
                            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono">
                              {summarizePayload(action.before)}
                            </pre>
                          </div>
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">变更后 (After)</div>
                            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono">
                              {summarizePayload(action.after)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {total > 20 && (
          <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
            <span>
              第 {page} / {totalPages} 页（共 {total} 条）
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
