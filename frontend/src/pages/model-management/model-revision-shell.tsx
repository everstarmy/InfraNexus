import type React from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, CopyPlus, History, Lock, Plus, Power, PowerOff, Send, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/common/page-header"
import { AssetStatusBadge } from "@/components/receiving/receiving-meta"
import { VersionConflictAlert, type VersionConflictState } from "@/components/receiving/version-conflict-alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { formatRevisionTitle, type CatalogModelDTO, type CatalogRevisionDTO } from "@/services/receiving-models"

function RevisionStateBadge({
  rev,
  supportsRevisionStatus,
}: {
  rev: CatalogRevisionDTO
  supportsRevisionStatus?: boolean
}) {
  if (rev.state === "draft") {
    return <AssetStatusBadge state="draft" customLabel="草稿" />
  }
  if (!supportsRevisionStatus) {
    return <AssetStatusBadge state="published" />
  }
  if (rev.status === 2) {
    return (
      <Badge variant="secondary" className="font-normal whitespace-nowrap">
        已发布 · 停用
      </Badge>
    )
  }
  return (
    <Badge variant="default" className="font-normal whitespace-nowrap">
      已发布 · 启用
    </Badge>
  )
}

export function ModelRevisionShell({
  backUrl,
  titlePrefix,
  model,
  manufacturerName,
  typeLabel,
  revisions,
  selectedRevisionId,
  selectedRevision,
  loading,
  conflict,
  onReloadConflict,
  onDismissConflict,
  canCreateRevision,
  canDeleteRevision,
  canPublishRevision,
  canToggleRevisionStatus = false,
  supportsRevisionStatus = false,
  canHistory,
  creatingRevision,
  publishingRevision,
  togglingRevisionStatus = false,
  onSelectRevision,
  onCreateRevision,
  onDeleteRevision,
  onPublishRevision,
  onToggleRevisionStatus,
  onOpenHistory,
  children,
}: {
  backUrl: string
  titlePrefix: string
  model?: CatalogModelDTO
  manufacturerName: string
  typeLabel: string
  revisions: CatalogRevisionDTO[]
  selectedRevisionId: string | null
  selectedRevision?: CatalogRevisionDTO
  loading: boolean
  conflict: VersionConflictState | null
  onReloadConflict: () => void
  onDismissConflict: () => void
  canCreateRevision: boolean
  canDeleteRevision: boolean
  canPublishRevision: boolean
  canToggleRevisionStatus?: boolean
  supportsRevisionStatus?: boolean
  canHistory: boolean
  creatingRevision: boolean
  publishingRevision: boolean
  togglingRevisionStatus?: boolean
  onSelectRevision: (revId: string) => void
  onCreateRevision: (fromRevisionId: string | null) => void
  onDeleteRevision: (rev: CatalogRevisionDTO) => void
  onPublishRevision: (rev: CatalogRevisionDTO) => void
  onToggleRevisionStatus?: (rev: CatalogRevisionDTO, nextStatus: number) => void
  onOpenHistory: () => void
  children: React.ReactNode
}) {
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <PageHeader
        title={model ? `${model.name}` : `${titlePrefix}详情`}
        description={
          model
            ? `${manufacturerName} · ${model.part_no || model.model_name || "—"} · ${typeLabel}`
            : "加载型号信息..."
        }
        badge={model ? <AssetStatusBadge state={model.status} /> : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(backUrl)}>
              <ArrowLeft className="mr-1.5 size-4" />
              返回列表
            </Button>
            {canHistory && model && (
              <Button size="sm" variant="outline" onClick={onOpenHistory}>
                <History className="mr-1.5 size-4" />
                操作历史
              </Button>
            )}
            {canCreateRevision && (
              <Button size="sm" variant="outline" disabled={creatingRevision} onClick={() => onCreateRevision(null)}>
                <Plus className="mr-1.5 size-4" />
                新建空白草稿
              </Button>
            )}
            {canCreateRevision && selectedRevision && (
              <Button
                size="sm"
                variant="outline"
                disabled={creatingRevision}
                onClick={() => onCreateRevision(selectedRevision.id)}
              >
                <CopyPlus className="mr-1.5 size-4" />
                基于 v{selectedRevision.revision_no} 复制新草稿
              </Button>
            )}
          </div>
        }
      />

      <VersionConflictAlert
        conflict={conflict}
        onReload={onReloadConflict}
        onDismiss={onDismissConflict}
      />

      {loading ? (
        <div className="flex h-56 items-center justify-center rounded-xl border bg-card">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4 md:gap-6">
          <div className="col-span-12 lg:col-span-3 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">版本列表</CardTitle>
                <CardDescription className="text-xs">
                  草稿可修改或发布；已发布版本永久只读，供后续业务引用。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {revisions.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    暂无修订版本，请点击右上角「新建空白草稿」。
                  </div>
                ) : (
                  revisions.map((rev) => {
                    const active = rev.id === selectedRevisionId
                    const revTitle = formatRevisionTitle(rev)
                    return (
                      <div
                        key={rev.id}
                        className={cn(
                          "rounded-lg border p-3 transition-colors cursor-pointer",
                          active ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                        )}
                        onClick={() => onSelectRevision(rev.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold leading-snug break-all">{revTitle}</span>
                          <RevisionStateBadge rev={rev} supportsRevisionStatus={supportsRevisionStatus} />
                        </div>
                        {rev.description && (
                          <div className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{rev.description}</div>
                        )}
                        <div className="mt-1.5 text-[11px] text-muted-foreground">
                          {rev.state === "published"
                            ? `发布于 ${formatDateTime(rev.published_at)}`
                            : `更新于 ${formatDateTime(rev.updated_at)}`}
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-9 space-y-4">
            {selectedRevision ? (
              <Card>
                <CardHeader className="border-b pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base font-semibold">
                          {formatRevisionTitle(selectedRevision)}
                        </CardTitle>
                        <RevisionStateBadge
                          rev={selectedRevision}
                          supportsRevisionStatus={supportsRevisionStatus}
                        />
                        <Badge variant="outline" className="font-mono text-[11px]">
                          修订版本 #{selectedRevision.version}
                        </Badge>
                        {selectedRevision.state === "published" && (
                          <Badge variant="secondary" className="text-[11px] gap-1">
                            <Lock className="size-3" />
                            已发布只读
                          </Badge>
                        )}
                      </div>
                      {selectedRevision.description && (
                        <CardDescription className="text-xs">{selectedRevision.description}</CardDescription>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {supportsRevisionStatus &&
                        selectedRevision.state === "published" &&
                        canToggleRevisionStatus &&
                        onToggleRevisionStatus && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={togglingRevisionStatus}
                            onClick={() =>
                              onToggleRevisionStatus(selectedRevision, selectedRevision.status === 2 ? 1 : 2)
                            }
                          >
                            {selectedRevision.status === 2 ? (
                              <>
                                <Power className="mr-1.5 size-3.5" />
                                启用版本
                              </>
                            ) : (
                              <>
                                <PowerOff className="mr-1.5 size-3.5" />
                                停用版本
                              </>
                            )}
                          </Button>
                        )}
                      {selectedRevision.state === "draft" && canDeleteRevision && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDeleteRevision(selectedRevision)}
                        >
                          <Trash2 className="mr-1.5 size-3.5" />
                          删除草稿
                        </Button>
                      )}
                      {selectedRevision.state === "draft" && canPublishRevision && (
                        <Button
                          size="sm"
                          disabled={publishingRevision || model?.status !== 1}
                          onClick={() => onPublishRevision(selectedRevision)}
                        >
                          <Send className="mr-1.5 size-3.5" />
                          {publishingRevision ? "发布中..." : "发布此版本"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {selectedRevision.state === "draft" && model?.status !== 1 && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      当前型号处于停用状态，需在型号列表启用后才能发布版本。
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-5">{children}</CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-sm text-muted-foreground">
                  请选择左侧版本或新建一个草稿版本开始配置规格。
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
