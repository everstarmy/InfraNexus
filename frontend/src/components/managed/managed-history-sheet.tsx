import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { History, Clock, ArrowRight, User } from "lucide-react"
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
import type { ManagedAudit, ManagedQueryParams } from "@/services/managed"
import type { Envelope, PageData } from "@/services/types"

const actionLabels: Record<string, { label: string; variant?: "default" | "outline" | "secondary" | "destructive" }> = {
  create: { label: "创建", variant: "default" },
  update: { label: "更新", variant: "outline" },
  move: { label: "更改上级", variant: "outline" },
  "security-zone": { label: "变更安全域", variant: "outline" },
  status: { label: "变更状态", variant: "secondary" },
  delete: { label: "删除", variant: "destructive" },
  import: { label: "批量导入", variant: "default" },
  reserve: { label: "人工保留", variant: "outline" },
  conflict: { label: "报告冲突", variant: "destructive" },
  resolve: { label: "解除冲突", variant: "secondary" },
}

export function ManagedHistorySheet({
  open,
  onOpenChange,
  resourceTitle,
  recordName,
  recordId,
  fetchHistory,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceTitle: string
  recordName?: string
  recordId?: string | null
  fetchHistory: (id: string, params?: ManagedQueryParams, signal?: AbortSignal) => Promise<Envelope<PageData<ManagedAudit>>>
}) {
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ["managed", "history", recordId, page],
    queryFn: ({ signal }) => fetchHistory(recordId!, { page, page_size: 20 }, signal),
    enabled: open && Boolean(recordId),
  })

  const items = data?.data.items ?? []
  const total = data?.data.total ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-md md:max-w-lg p-0">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <History className="size-4.5 text-primary" />
            <SheetTitle className="text-base font-semibold">变更历史审计</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            {resourceTitle} {recordName ? `「${recordName}」` : ""} 的版本变更与操作记录
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
              加载审计历史失败，请稍后重试。
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-xs text-muted-foreground">
              <Clock className="mb-2 size-6 opacity-30" />
              暂无变更记录
            </div>
          ) : (
            <div className="relative border-l border-border/60 pl-4 space-y-6 my-2">
              {items.map((audit) => {
                const actionMeta = actionLabels[audit.action] ?? { label: audit.action, variant: "outline" }
                return (
                  <div key={audit.id} className="relative group">
                    <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border border-background bg-primary ring-2 ring-background" />

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={actionMeta.variant} className="text-[11px] px-1.5 py-0 h-5 font-normal">
                            {actionMeta.label}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground">
                            v{audit.after?.version ?? audit.before?.version ?? "—"}
                          </span>
                        </div>
                        <time className="text-[11px] text-muted-foreground">
                          {formatDateTime(audit.created_at)}
                        </time>
                      </div>

                      {/* Detail diffs */}
                      <div className="rounded-md border bg-muted/40 p-2.5 text-xs space-y-1 font-mono">
                        {audit.before?.name && audit.after?.name && audit.before.name !== audit.after.name && (
                          <div className="flex items-center gap-1.5">
                            <span>名称：</span>
                            <span>{audit.before.name}</span>
                            <ArrowRight className="size-3 text-muted-foreground" />
                            <span>{audit.after.name}</span>
                          </div>
                        )}
                        {audit.after?.status !== undefined && audit.before?.status !== undefined && audit.after.status !== audit.before.status && (
                          <div className="flex items-center gap-1.5 text-foreground/80">
                            <span className="text-muted-foreground font-sans">状态：</span>
                            <span>{audit.before.status === 1 ? "启用" : "停用"}</span>
                            <ArrowRight className="size-3 text-muted-foreground" />
                            <span className="font-semibold">{audit.after.status === 1 ? "启用" : "停用"}</span>
                          </div>
                        )}
                        {(audit.before?.location || audit.after?.location) && <details>
                          <summary className="cursor-pointer font-sans">位置属性</summary>
                          {([["变更前", audit.before?.location], ["变更后", audit.after?.location]] as const).map(([label, location]) =>
                            location && <div key={label} className="mt-2">
                              <p className="font-sans text-muted-foreground">{label}</p>
                              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(location, null, 2)}</pre>
                            </div>
                          )}
                        </details>}
                        {audit.after?.reason && (
                          <div className="text-foreground/80 font-sans">
                            <span className="text-muted-foreground">原因：</span>
                            {audit.after.reason}
                          </div>
                        )}
                        {audit.after?.evidence_ref && (
                          <div className="text-foreground/80 font-sans truncate">
                            <span className="text-muted-foreground">凭证引用：</span>
                            {audit.after.evidence_ref}
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground/70 font-sans">
                          <span className="truncate max-w-[200px]" title={audit.request_id}>
                            Req: {audit.request_id || "—"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <User className="size-3" />
                            {audit.actor_id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {total > 20 && (
          <div className="border-t px-6 py-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>共 {total} 条记录</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span>第 {page} 页</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * 20 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
