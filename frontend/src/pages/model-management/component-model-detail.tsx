import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { useConfirm } from "@/components/common/confirm-dialog"
import {
  labelComponentKind,
  useCompanyOptions,
  useReceivingMetadata,
} from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import {
  SpecSchemaEditor,
  SpecSummaryGrid,
  validateSpecAgainstSchema,
} from "@/components/receiving/spec-schema-editor"
import type { VersionConflictState } from "@/components/receiving/version-conflict-alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getErrorMessage, getReceivingError, isVersionConflict } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import {
  createIdempotencyKey,
  normalizeSpecPayload,
  type AssetSpec,
} from "@/services/receiving-metadata"
import {
  componentModelsService,
  type CatalogRevisionDTO,
} from "@/services/receiving-models"
import { useAuth } from "@/stores/auth-context"
import { ModelRevisionShell } from "./model-revision-shell"

export default function ComponentModelDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()

  const canRead = can("model-management:component-models:read")
  const canCreateRev = can("model-management:component-models:create")
  const canUpdateRev = can("model-management:component-models:update")
  const canDeleteRev = can("model-management:component-models:delete")
  const canPublishRev = can("model-management:component-models:publish")
  const canHistory = can("model-management:component-models:history")

  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null)
  const [specDraft, setSpecDraft] = useState<AssetSpec>({ schema_version: 1 })
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState<VersionConflictState | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const metadataQuery = useReceivingMetadata(canRead)
  const companiesQuery = useCompanyOptions(canRead)

  const modelQuery = useQuery({
    queryKey: queryKeys.componentModel(id),
    queryFn: ({ signal }) => componentModelsService.get(id, signal),
    enabled: canRead && Boolean(id),
  })

  const revisionsQuery = useQuery({
    queryKey: queryKeys.componentModelRevisions(id, { page: 1, page_size: 100 }),
    queryFn: ({ signal }) => componentModelsService.listRevisions(id, { page: 1, page_size: 100 }, signal),
    enabled: canRead && Boolean(id),
  })

  const revisions = useMemo(() => {
    const items = [...(revisionsQuery.data?.data.items ?? [])]
    return items.sort((a, b) => b.revision_no - a.revision_no)
  }, [revisionsQuery.data])

  useEffect(() => {
    if (revisions.length === 0) {
      setSelectedRevisionId(null)
      return
    }
    if (!selectedRevisionId || !revisions.some((r) => r.id === selectedRevisionId)) {
      setSelectedRevisionId(revisions[0].id)
      setDirty(false)
      setConflict(null)
    }
  }, [revisions, selectedRevisionId])

  const revisionDetailQuery = useQuery({
    queryKey: queryKeys.componentModelRevision(id, selectedRevisionId ?? ""),
    queryFn: ({ signal }) => componentModelsService.getRevision(id, selectedRevisionId!, signal),
    enabled: canRead && Boolean(id) && Boolean(selectedRevisionId),
  })

  const selectedRevision = revisionDetailQuery.data?.data

  useEffect(() => {
    if (selectedRevision && !dirty) {
      setSpecDraft(selectedRevision.spec ?? { schema_version: 1 })
    }
  }, [selectedRevision, dirty])

  const model = modelQuery.data?.data
  const schema = model?.kind ? metadataQuery.data?.data.spec_schemas[model.kind] : undefined

  const manufacturerName = useMemo(() => {
    if (!model) return "—"
    return companiesQuery.data?.data.items.find((c) => c.id === model.manufacturer_id)?.name ?? model.manufacturer_id
  }, [companiesQuery.data, model])

  const createRevisionMutation = useMutation({
    mutationFn: (fromRevisionId: string | null) =>
      componentModelsService.createRevision(id, fromRevisionId, createIdempotencyKey("comp-rev")),
    onSuccess: (res) => {
      notify.success(`已创建草稿版本 v${res.data.revision_no}`)
      setDirty(false)
      setConflict(null)
      setSelectedRevisionId(res.data.id)
      queryClient.invalidateQueries({ queryKey: queryKeys.componentModelsAll })
    },
    onError: (err) => {
      notify.error(getErrorMessage(err, "创建版本失败"))
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRevision) throw new Error("missing revision")
      return componentModelsService.updateRevision(id, selectedRevision.id, selectedRevision.version, {
        tracking_mode: "individual",
        unit: "piece",
        spec: normalizeSpecPayload(specDraft, schema),
      })
    },
    onSuccess: () => {
      notify.success("规格草稿已保存")
      setDirty(false)
      setConflict(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.componentModelsAll })
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        const info = getReceivingError(err)
        setConflict({
          message: getErrorMessage(err, "该组件版本已被他人更新"),
          currentVersion: info?.current_version,
          localSummary: "保留了当前规格编辑表单",
        })
        return
      }
      notify.error(getErrorMessage(err, "保存组件规格失败"))
    },
  })

  const deleteRevisionMutation = useMutation({
    mutationFn: (rev: CatalogRevisionDTO) =>
      componentModelsService.deleteRevision(id, rev.id, rev.version),
    onSuccess: () => {
      notify.success("草稿版本已删除")
      setDirty(false)
      setConflict(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.componentModelsAll })
    },
    onError: (err) => {
      notify.error(getErrorMessage(err, "删除版本失败"))
    },
  })

  const publishRevisionMutation = useMutation({
    mutationFn: (rev: CatalogRevisionDTO) =>
      componentModelsService.publishRevision(id, rev.id, rev.version, createIdempotencyKey("comp-pub")),
    onSuccess: (res) => {
      notify.success(`版本 v${res.data.revision_no} 已发布，现为只读状态`)
      setDirty(false)
      setConflict(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.componentModelsAll })
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        const info = getReceivingError(err)
        setConflict({
          message: getErrorMessage(err, "版本已被修改，请刷新后确认再发布"),
          currentVersion: info?.current_version,
        })
        return
      }
      notify.error(getErrorMessage(err, "发布版本失败"))
    },
  })

  const isDraft = selectedRevision?.state === "draft"

  return (
    <>
      <ModelRevisionShell
        backUrl="/model-management/component-models"
        titlePrefix="组件型号"
        model={model}
        manufacturerName={manufacturerName}
        typeLabel={labelComponentKind(model?.kind)}
        revisions={revisions}
        selectedRevisionId={selectedRevisionId}
        selectedRevision={selectedRevision}
        loading={modelQuery.isLoading || revisionsQuery.isLoading}
        conflict={conflict}
        onReloadConflict={async () => {
          setDirty(false)
          await Promise.all([modelQuery.refetch(), revisionsQuery.refetch(), revisionDetailQuery.refetch()])
          setConflict(null)
        }}
        onDismissConflict={() => setConflict(null)}
        canCreateRevision={canCreateRev}
        canDeleteRevision={canDeleteRev}
        canPublishRevision={canPublishRev}
        canHistory={canHistory}
        creatingRevision={createRevisionMutation.isPending}
        publishingRevision={publishRevisionMutation.isPending}
        onSelectRevision={(revId) => {
          setSelectedRevisionId(revId)
          setDirty(false)
          setConflict(null)
        }}
        onCreateRevision={(fromId) => createRevisionMutation.mutate(fromId)}
        onDeleteRevision={(rev) => {
          confirm({
            title: `删除草稿版本 v${rev.revision_no}`,
            description: "删除后不可恢复。",
            confirmText: "确认删除",
            tone: "destructive",
            onConfirm: () => deleteRevisionMutation.mutateAsync(rev),
          })
        }}
        onPublishRevision={(rev) => {
          if (dirty) {
            notify.warning("当前草稿存在未保存更改，请先保存后再发布")
            return
          }
          const validationError = validateSpecAgainstSchema(specDraft, schema)
          if (validationError) {
            notify.warning(validationError)
            return
          }
          confirm({
            title: `发布版本 v${rev.revision_no}`,
            description: "发布后版本内容将被锁定为只读，无法再修改或删除，并可被设备型号与到货单引用。",
            confirmText: "确认发布",
            onConfirm: () => publishRevisionMutation.mutateAsync(rev),
          })
        }}
        onOpenHistory={() => setHistoryOpen(true)}
      >
        {selectedRevision && (
          <div className="space-y-5">
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-6 space-y-1.5">
                <Label className="text-xs">追踪模式 (Tracking Mode)</Label>
                <Input value="individual（逐件实物追踪）" disabled />
              </div>
              <div className="col-span-12 sm:col-span-6 space-y-1.5">
                <Label className="text-xs">计量单位 (Unit)</Label>
                <Input value="piece（件）" disabled />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">组件规格参数（{labelComponentKind(model?.kind)}）</h3>
                {isDraft && canUpdateRev && (
                  <Button
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => {
                      const err = validateSpecAgainstSchema(specDraft, schema)
                      if (err) {
                        notify.warning(err)
                        return
                      }
                      saveMutation.mutate()
                    }}
                  >
                    <Save className="mr-1.5 size-3.5" />
                    {saveMutation.isPending ? "保存中..." : "保存规格草稿"}
                  </Button>
                )}
              </div>

              {isDraft ? (
                <SpecSchemaEditor
                  schema={schema}
                  value={specDraft}
                  disabled={!canUpdateRev || saveMutation.isPending}
                  onChange={(next) => {
                    setSpecDraft(next)
                    setDirty(true)
                  }}
                />
              ) : (
                <SpecSummaryGrid schema={schema} spec={selectedRevision.spec} />
              )}
            </div>
          </div>
        )}
      </ModelRevisionShell>

      <ReceivingHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="组件型号"
        recordLabel={model?.name}
        recordId={id}
        queryKey={(page) => queryKeys.componentModelHistory(id, page)}
        fetchHistory={(targetId, params, signal) => componentModelsService.history(targetId, params, signal)}
      />
    </>
  )
}
