import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Plus, Save, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/common/confirm-dialog"
import {
  AssetStatusBadge,
  MOUNTING_TYPE_LABELS,
  labelComponentKind,
  labelDeviceCategory,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { getErrorMessage, getReceivingError, isVersionConflict } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import {
  createIdempotencyKey,
  normalizeSpecPayload,
  type AssetSpec,
} from "@/services/receiving-metadata"
import {
  deviceModelsService,
  listPublishedComponentRevisions,
  type CatalogRevisionDTO,
  type CompatibilityStatus,
  type ModelCompatibilityInput,
  type ModelPortInput,
  type ModelSlotInput,
  type ModelStandardComponentInput,
  type MountingType,
  type PortSourceKind,
} from "@/services/receiving-models"
import { useAuth } from "@/stores/auth-context"
import { ModelRevisionShell } from "./model-revision-shell"

interface DeviceRevisionFormState {
  name: string
  description: string
  mounting_type: MountingType
  height_u: number | null
  rated_power_w: number | null
  spec: AssetSpec
  slots: ModelSlotInput[]
  ports: ModelPortInput[]
  standard_components: ModelStandardComponentInput[]
  compatibilities: ModelCompatibilityInput[]
}

function toFormState(rev: CatalogRevisionDTO): DeviceRevisionFormState {
  const mounting = (rev.mounting_type || "rack") as MountingType
  return {
    name: rev.name ?? "",
    description: rev.description ?? "",
    mounting_type: mounting,
    height_u: mounting === "rack" ? rev.height_u ?? 2 : null,
    rated_power_w: rev.rated_power_w ?? null,
    spec: rev.spec ?? { schema_version: 1 },
    slots: (rev.slots ?? []).map((s) => ({
      id: s.id,
      stable_key: s.stable_key,
      name: s.name,
      kind: s.kind,
      interface: s.interface ?? null,
      form_factor: s.form_factor ?? null,
      position: s.position ?? { schema_version: 1 },
    })),
    ports: (rev.ports ?? []).map((p) => ({
      id: p.id,
      stable_key: p.stable_key,
      name: p.name,
      protocol: p.protocol,
      connector: p.connector,
      speed_mbps: p.speed_mbps ?? null,
      source_kind: p.source_kind,
      slot_key: p.slot_key ?? null,
    })),
    standard_components: (rev.standard_components ?? []).map((c) => ({
      id: c.id,
      part_model_revision_id: c.part_model_revision_id,
      slot_key: c.slot_key ?? null,
      quantity: c.quantity,
      required: c.required,
    })),
    compatibilities: (rev.compatibilities ?? []).map((c) => ({
      id: c.id,
      part_model_revision_id: c.part_model_revision_id,
      slot_key: c.slot_key ?? null,
      status: c.status,
      evidence_note: c.evidence_note ?? "",
    })),
  }
}

export default function DeviceModelDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()

  const canRead = can("model-management:device-models:read")
  const canCreateRev = can("model-management:device-models:create")
  const canUpdateRev = can("model-management:device-models:update")
  const canDeleteRev = can("model-management:device-models:delete")
  const canPublishRev = can("model-management:device-models:publish")
  const canStatusRev = can("model-management:device-models:status")
  const canHistory = can("model-management:device-models:history")
  const canReadComponents = can("model-management:component-models:read")

  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null)
  const [form, setForm] = useState<DeviceRevisionFormState>(() => ({
    name: "",
    description: "",
    mounting_type: "rack",
    height_u: 2,
    rated_power_w: null,
    spec: { schema_version: 1 },
    slots: [],
    ports: [],
    standard_components: [],
    compatibilities: [],
  }))
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState<VersionConflictState | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const metadataQuery = useReceivingMetadata(canRead)
  const companiesQuery = useCompanyOptions(canRead)

  const publishedComponentOptionsQuery = useQuery({
    queryKey: queryKeys.publishedComponentRevisions,
    queryFn: ({ signal }) => listPublishedComponentRevisions(signal),
    enabled: canRead && canReadComponents,
    staleTime: 60 * 1000,
  })

  const modelQuery = useQuery({
    queryKey: queryKeys.deviceModel(id),
    queryFn: ({ signal }) => deviceModelsService.get(id, signal),
    enabled: canRead && Boolean(id),
  })

  const revisionsQuery = useQuery({
    queryKey: queryKeys.deviceModelRevisions(id, { page: 1, page_size: 100 }),
    queryFn: ({ signal }) => deviceModelsService.listRevisions(id, { page: 1, page_size: 100 }, signal),
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
    queryKey: queryKeys.deviceModelRevision(id, selectedRevisionId ?? ""),
    queryFn: ({ signal }) => deviceModelsService.getRevision(id, selectedRevisionId!, signal),
    enabled: canRead && Boolean(id) && Boolean(selectedRevisionId),
  })

  const selectedRevision = revisionDetailQuery.data?.data

  useEffect(() => {
    if (selectedRevision && !dirty) {
      setForm(toFormState(selectedRevision))
    }
  }, [selectedRevision, dirty])

  const model = modelQuery.data?.data
  const deviceSchema = metadataQuery.data?.data.spec_schemas.device
  const componentKinds = metadataQuery.data?.data.component_kinds ?? []
  const componentRevOptions = publishedComponentOptionsQuery.data ?? []
  const selectableComponentRevOptions = useMemo(
    () => componentRevOptions.filter((opt) => opt.model.status === 1),
    [componentRevOptions],
  )

  const componentRevLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const opt of componentRevOptions) {
      map.set(opt.revision.id, opt.label)
    }
    return map
  }, [componentRevOptions])

  const manufacturerName = useMemo(() => {
    if (!model) return "—"
    return companiesQuery.data?.data.items.find((c) => c.id === model.manufacturer_id)?.name ?? model.manufacturer_id
  }, [companiesQuery.data, model])

  const slotKeys = useMemo(
    () => form.slots.map((s) => s.stable_key.trim()).filter(Boolean),
    [form.slots],
  )

  const patchForm = (updater: (prev: DeviceRevisionFormState) => DeviceRevisionFormState) => {
    setForm((prev) => updater(prev))
    setDirty(true)
  }

  const validateDraft = (): string | null => {
    if (!form.name.trim()) {
      return "请填写配置名称"
    }
    if (form.name.trim().length > 128) {
      return "配置名称长度不能超过 128 个字符"
    }
    if (form.description.trim().length > 1024) {
      return "配置说明长度不能超过 1024 个字符"
    }
    if (form.mounting_type === "rack" && (!form.height_u || form.height_u < 1)) {
      return "机架式设备必须填写有效的高度 (U 数 >= 1)"
    }
    if (form.rated_power_w !== null && form.rated_power_w <= 0) {
      return "额定功率必须大于 0"
    }
    const specErr = validateSpecAgainstSchema(form.spec, deviceSchema)
    if (specErr) return specErr

    const seenSlots = new Set<string>()
    for (const s of form.slots) {
      if (!s.stable_key.trim() || !s.name.trim() || !s.kind) {
        return "每个槽位必须填写 Stable Key、名称与组件类别"
      }
      if (seenSlots.has(s.stable_key.trim())) {
        return `槽位 Stable Key「${s.stable_key}」重复`
      }
      seenSlots.add(s.stable_key.trim())
    }
    const seenPorts = new Set<string>()
    for (const p of form.ports) {
      if (!p.stable_key.trim() || !p.name.trim() || !p.protocol.trim() || !p.connector.trim()) {
        return "每个端口必须填写 Stable Key、名称、协议和连接器"
      }
      if (seenPorts.has(p.stable_key.trim())) {
        return `端口 Stable Key「${p.stable_key}」重复`
      }
      seenPorts.add(p.stable_key.trim())
      if (p.source_kind === "option_slot" && !p.slot_key) {
        return `扩展槽端口「${p.name}」必须绑定所属槽位`
      }
    }
    for (const c of form.standard_components) {
      if (!c.part_model_revision_id) return "标配组件必须选择已发布的组件版本"
      if (c.slot_key && c.quantity !== 1) return "绑定具体槽位的标配组件数量必须为 1"
      if (c.quantity < 1 || c.quantity > 512) return "每条标配组件数量需在 1～512 之间"
    }
    for (const c of form.compatibilities) {
      if (!c.part_model_revision_id) return "兼容性规则必须选择已发布的组件版本"
      if (c.status === "confirmed" && !c.evidence_note.trim()) {
        return "已确认兼容的关系必须填写验证依据备注"
      }
    }
    return null
  }

  const createRevisionMutation = useMutation({
    mutationFn: (fromRevisionId: string | null) =>
      deviceModelsService.createRevision(id, fromRevisionId, createIdempotencyKey("dev-rev")),
    onSuccess: (res) => {
      notify.success(`已创建设备版本草稿 v${res.data.revision_no}`)
      setDirty(false)
      setConflict(null)
      setSelectedRevisionId(res.data.id)
      queryClient.invalidateQueries({ queryKey: queryKeys.deviceModelsAll })
    },
    onError: (err) => notify.error(getErrorMessage(err, "创建版本失败")),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRevision) throw new Error("missing revision")
      return deviceModelsService.updateRevision(id, selectedRevision.id, selectedRevision.version, {
        name: form.name.trim(),
        description: form.description.trim(),
        mounting_type: form.mounting_type,
        height_u: form.mounting_type === "rack" ? form.height_u : null,
        rated_power_w: form.rated_power_w,
        spec: normalizeSpecPayload(form.spec, deviceSchema),
        slots: form.slots.map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          stable_key: s.stable_key.trim(),
          name: s.name.trim(),
          kind: s.kind,
          interface: s.interface?.trim() || null,
          form_factor: s.form_factor?.trim() || null,
          position: {
            schema_version: 1,
            side: s.position.side?.trim() || null,
            row: s.position.row ?? null,
            column: s.position.column ?? null,
          },
        })),
        ports: form.ports.map((p) => ({
          ...(p.id ? { id: p.id } : {}),
          stable_key: p.stable_key.trim(),
          name: p.name.trim(),
          protocol: p.protocol.trim(),
          connector: p.connector.trim(),
          speed_mbps: p.speed_mbps ?? null,
          source_kind: p.source_kind,
          slot_key: p.source_kind === "option_slot" ? p.slot_key : null,
        })),
        standard_components: form.standard_components.map((c) => ({
          ...(c.id ? { id: c.id } : {}),
          part_model_revision_id: c.part_model_revision_id,
          slot_key: c.slot_key || null,
          quantity: c.slot_key ? 1 : c.quantity,
          required: c.required,
        })),
        compatibilities: form.compatibilities.map((c) => ({
          ...(c.id ? { id: c.id } : {}),
          part_model_revision_id: c.part_model_revision_id,
          slot_key: c.slot_key || null,
          status: c.status,
          evidence_note: c.evidence_note.trim(),
        })),
      })
    },
    onSuccess: (res) => {
      notify.success("设备型号版本草稿已保存")
      setDirty(false)
      setConflict(null)
      setForm(toFormState(res.data))
      queryClient.invalidateQueries({ queryKey: queryKeys.deviceModelsAll })
      queryClient.invalidateQueries({ queryKey: queryKeys.publishedDeviceRevisions })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectableDeviceRevisionsAll })
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        const info = getReceivingError(err)
        setConflict({
          message: getErrorMessage(err, "该设备型号版本已被他人修改"),
          currentVersion: info?.current_version,
          localSummary: `已保留本地草稿（${form.slots.length} 个槽位，${form.standard_components.length} 项标配）`,
        })
        return
      }
      notify.error(getErrorMessage(err, "保存设备版本草稿失败"))
    },
  })

  const deleteRevisionMutation = useMutation({
    mutationFn: (rev: CatalogRevisionDTO) => deviceModelsService.deleteRevision(id, rev.id, rev.version),
    onSuccess: () => {
      notify.success("草稿版本已删除")
      setDirty(false)
      setConflict(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.deviceModelsAll })
    },
    onError: (err) => notify.error(getErrorMessage(err, "删除版本失败")),
  })

  const publishRevisionMutation = useMutation({
    mutationFn: (rev: CatalogRevisionDTO) =>
      deviceModelsService.publishRevision(id, rev.id, rev.version, createIdempotencyKey("dev-pub")),
    onSuccess: (res) => {
      notify.success(`设备版本 v${res.data.revision_no} 已发布，可供到货单选用`)
      setDirty(false)
      setConflict(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.deviceModelsAll })
      queryClient.invalidateQueries({ queryKey: queryKeys.publishedDeviceRevisions })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectableDeviceRevisionsAll })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectableDeviceModels })
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        const info = getReceivingError(err)
        setConflict({
          message: getErrorMessage(err, "设备版本状态已变化，请重新加载后确认"),
          currentVersion: info?.current_version,
        })
        return
      }
      notify.error(getErrorMessage(err, "发布版本失败（请检查标配组件是否均已配置确认兼容规则）"))
    },
  })

  const toggleRevisionStatusMutation = useMutation({
    mutationFn: ({ rev, nextStatus }: { rev: CatalogRevisionDTO; nextStatus: number }) =>
      deviceModelsService.setRevisionStatus(id, rev.id, rev.version, nextStatus),
    onSuccess: async (res, vars) => {
      notify.success(`设备版本 v${res.data.revision_no} 已${vars.nextStatus === 1 ? "启用" : "停用"}`)
      setConflict(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deviceModelRevision(id, res.data.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.deviceModelRevisionsAll(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.deviceModel(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.deviceModelsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.selectableDeviceRevisionsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.selectableDeviceModels }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publishedDeviceRevisions }),
      ])
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        const info = getReceivingError(err)
        setConflict({
          message: getErrorMessage(err, "设备版本状态已被他人更新，请重新加载后确认"),
          currentVersion: info?.current_version,
        })
        return
      }
      notify.error(getErrorMessage(err, "变更版本启用状态失败"))
    },
  })

  const isDraft = selectedRevision?.state === "draft"
  const editable = Boolean(isDraft && canUpdateRev)

  const ensureConfirmedCompatibility = (partRevId: string, slotKey: string | null) => {
    const exists = form.compatibilities.some(
      (c) => c.part_model_revision_id === partRevId && (c.slot_key ?? null) === (slotKey ?? null) && c.status === "confirmed",
    )
    if (exists) {
      notify.info("已存在对应的确认兼容规则")
      return
    }
    patchForm((prev) => ({
      ...prev,
      compatibilities: [
        ...prev.compatibilities,
        {
          part_model_revision_id: partRevId,
          slot_key: slotKey ?? null,
          status: "confirmed",
          evidence_note: "设备标配兼容清单确认",
        },
      ],
    }))
    notify.success("已添加到兼容列表（状态：已确认兼容），记得保存草稿")
  }

  return (
    <>
      <ModelRevisionShell
        backUrl="/model-management/device-models"
        titlePrefix="设备型号"
        model={model}
        manufacturerName={manufacturerName}
        typeLabel={labelDeviceCategory(model?.category)}
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
        supportsRevisionStatus
        canToggleRevisionStatus={canStatusRev}
        canHistory={canHistory}
        creatingRevision={createRevisionMutation.isPending}
        publishingRevision={publishRevisionMutation.isPending}
        togglingRevisionStatus={toggleRevisionStatusMutation.isPending}
        onSelectRevision={(revId) => {
          setSelectedRevisionId(revId)
          setDirty(false)
          setConflict(null)
        }}
        onCreateRevision={(fromId) => createRevisionMutation.mutate(fromId)}
        onDeleteRevision={(rev) => {
          confirm({
            title: `删除设备草稿版本 v${rev.revision_no}`,
            description: "删除后槽位、端口与标配模板将一并清除，不可恢复。",
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
          const err = validateDraft()
          if (err) {
            notify.warning(err)
            return
          }
          confirm({
            title: `发布设备版本 v${rev.revision_no}`,
            description: "发布后版本内容永久只读，将可供新建到货单选择。",
            confirmText: "确认发布",
            onConfirm: () => publishRevisionMutation.mutateAsync(rev),
          })
        }}
        onToggleRevisionStatus={(rev, nextStatus) => {
          const actionText = nextStatus === 1 ? "启用" : "停用"
          confirm({
            title: `${actionText}设备配置版本 v${rev.revision_no}`,
            description:
              nextStatus === 2
                ? "停用后新建到货单明细将不再列出该配置版本；已有的到货单、验收单和设备资产不受影响。"
                : "启用后该配置版本将重新出现在新建到货单明细的可选列表中。",
            confirmText: `确认${actionText}`,
            tone: nextStatus === 2 ? "destructive" : "default",
            onConfirm: () => toggleRevisionStatusMutation.mutateAsync({ rev, nextStatus }),
          })
        }}
        onOpenHistory={() => setHistoryOpen(true)}
      >
        {selectedRevision && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>槽位 {form.slots.length}</span>
                <span>·</span>
                <span>端口 {form.ports.length}</span>
                <span>·</span>
                <span>标配组件 {form.standard_components.length}</span>
                <span>·</span>
                <span>兼容规则 {form.compatibilities.length}</span>
              </div>

              {editable && (
                <Button
                  size="sm"
                  disabled={saveMutation.isPending}
                  onClick={() => {
                    const err = validateDraft()
                    if (err) {
                      notify.warning(err)
                      return
                    }
                    saveMutation.mutate()
                  }}
                >
                  <Save className="mr-1.5 size-3.5" />
                  {saveMutation.isPending ? "保存中..." : "保存全部草稿内容"}
                </Button>
              )}
            </div>

            <Tabs defaultValue="general" className="w-full">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="general">形态与规格</TabsTrigger>
                <TabsTrigger value="slots">槽位模板 ({form.slots.length})</TabsTrigger>
                <TabsTrigger value="ports">端口模板 ({form.ports.length})</TabsTrigger>
                <TabsTrigger value="standard">标配组件 ({form.standard_components.length})</TabsTrigger>
                <TabsTrigger value="compat">兼容清单 ({form.compatibilities.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="mt-4 space-y-5">
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 md:col-span-5 space-y-1.5">
                    <Label htmlFor="dev-rev-name" className="text-xs">
                      配置名称 *
                    </Label>
                    <Input
                      id="dev-rev-name"
                      maxLength={128}
                      disabled={!editable}
                      value={form.name}
                      placeholder="例如：512 GB 内存 / 4 盘"
                      onChange={(e) => patchForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-7 space-y-1.5">
                    <Label htmlFor="dev-rev-desc" className="text-xs">
                      配置说明
                    </Label>
                    <Textarea
                      id="dev-rev-desc"
                      rows={1}
                      maxLength={1024}
                      disabled={!editable}
                      value={form.description}
                      placeholder="可选，描述该版本的配置规格、用途或区别"
                      onChange={(e) => patchForm((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 sm:col-span-4 space-y-1.5">
                    <Label htmlFor="dev-mounting" className="text-xs">
                      安装形态 *
                    </Label>
                    <NativeSelect
                      id="dev-mounting"
                      disabled={!editable}
                      value={form.mounting_type}
                      onChange={(e) => {
                        const nextMounting = e.target.value as MountingType
                        patchForm((prev) => ({
                          ...prev,
                          mounting_type: nextMounting,
                          height_u: nextMounting === "rack" ? prev.height_u ?? 2 : null,
                        }))
                      }}
                    >
                      {Object.entries(MOUNTING_TYPE_LABELS).map(([k, label]) => (
                        <NativeSelectOption key={k} value={k}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>

                  <div className="col-span-12 sm:col-span-4 space-y-1.5">
                    <Label htmlFor="dev-height" className="text-xs">
                      机架高度 (U) {form.mounting_type === "rack" ? "*" : "（非机架置空）"}
                    </Label>
                    <Input
                      id="dev-height"
                      type="number"
                      min={1}
                      disabled={!editable || form.mounting_type !== "rack"}
                      value={form.mounting_type === "rack" ? form.height_u ?? "" : ""}
                      placeholder={form.mounting_type === "rack" ? "如 2" : "不适用"}
                      onChange={(e) => {
                        const val = e.target.value ? Math.trunc(Number(e.target.value)) : null
                        patchForm((prev) => ({ ...prev, height_u: val }))
                      }}
                    />
                  </div>

                  <div className="col-span-12 sm:col-span-4 space-y-1.5">
                    <Label htmlFor="dev-power" className="text-xs">
                      额定功率 (W)
                    </Label>
                    <Input
                      id="dev-power"
                      type="number"
                      min={1}
                      disabled={!editable}
                      value={form.rated_power_w ?? ""}
                      placeholder="可选，如 1400"
                      onChange={(e) => {
                        const val = e.target.value ? Math.trunc(Number(e.target.value)) : null
                        patchForm((prev) => ({ ...prev, rated_power_w: val }))
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium">设备物理规格</h4>
                  {isDraft ? (
                    <SpecSchemaEditor
                      schema={deviceSchema}
                      value={form.spec}
                      disabled={!editable}
                      onChange={(spec) => patchForm((prev) => ({ ...prev, spec }))}
                    />
                  ) : (
                    <SpecSummaryGrid schema={deviceSchema} spec={selectedRevision.spec} />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="slots" className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    定义主板上可安装组件的槽位 Key，端口与标配组件可引用这些 Stable Key。
                  </p>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patchForm((prev) => ({
                          ...prev,
                          slots: [
                            ...prev.slots,
                            {
                              stable_key: `SLOT_${prev.slots.length + 1}`,
                              name: `槽位 ${prev.slots.length + 1}`,
                              kind: componentKinds[0] ?? "memory",
                              interface: null,
                              form_factor: null,
                              position: { schema_version: 1, side: "front", row: null, column: null },
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      新增槽位
                    </Button>
                  )}
                </div>

                {form.slots.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    暂无槽位模板
                  </div>
                ) : (
                  <div className="space-y-3">
                    {form.slots.map((slot, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2.5 rounded-lg border p-3">
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">Stable Key *</Label>
                          <Input
                            disabled={!editable}
                            value={slot.stable_key}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.slots]
                                next[idx] = { ...slot, stable_key: e.target.value }
                                return { ...prev, slots: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">名称 *</Label>
                          <Input
                            disabled={!editable}
                            value={slot.name}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.slots]
                                next[idx] = { ...slot, name: e.target.value }
                                return { ...prev, slots: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">类别 *</Label>
                          <NativeSelect
                            disabled={!editable}
                            value={slot.kind}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.slots]
                                next[idx] = { ...slot, kind: e.target.value }
                                return { ...prev, slots: next }
                              })
                            }
                          >
                            {componentKinds.map((k) => (
                              <NativeSelectOption key={k} value={k}>
                                {labelComponentKind(k)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">接口</Label>
                          <Input
                            disabled={!editable}
                            value={slot.interface ?? ""}
                            placeholder="如 DDR5 / PCIe5"
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.slots]
                                next[idx] = { ...slot, interface: e.target.value || null }
                                return { ...prev, slots: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">外形 / 面板侧</Label>
                          <Input
                            disabled={!editable}
                            value={slot.position.side ?? ""}
                            placeholder="front / rear"
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.slots]
                                next[idx] = {
                                  ...slot,
                                  position: { ...slot.position, schema_version: 1, side: e.target.value || null },
                                }
                                return { ...prev, slots: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 flex items-end justify-end">
                          {editable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() =>
                                patchForm((prev) => ({
                                  ...prev,
                                  slots: prev.slots.filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="ports" className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    区分主板固定端口 (`fixed`) 与依赖扩展槽位卡的端口 (`option_slot`)。
                  </p>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patchForm((prev) => ({
                          ...prev,
                          ports: [
                            ...prev.ports,
                            {
                              stable_key: `PORT_${prev.ports.length + 1}`,
                              name: `Eth${prev.ports.length + 1}`,
                              protocol: "Ethernet",
                              connector: "SFP28",
                              speed_mbps: 25000,
                              source_kind: "fixed",
                              slot_key: null,
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      新增端口
                    </Button>
                  )}
                </div>

                {form.ports.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    暂无端口模板
                  </div>
                ) : (
                  <div className="space-y-3">
                    {form.ports.map((port, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2.5 rounded-lg border p-3">
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">Stable Key *</Label>
                          <Input
                            disabled={!editable}
                            value={port.stable_key}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.ports]
                                next[idx] = { ...port, stable_key: e.target.value }
                                return { ...prev, ports: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">端口名 *</Label>
                          <Input
                            disabled={!editable}
                            value={port.name}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.ports]
                                next[idx] = { ...port, name: e.target.value }
                                return { ...prev, ports: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">协议 *</Label>
                          <Input
                            disabled={!editable}
                            value={port.protocol}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.ports]
                                next[idx] = { ...port, protocol: e.target.value }
                                return { ...prev, ports: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">连接器 *</Label>
                          <Input
                            disabled={!editable}
                            value={port.connector}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.ports]
                                next[idx] = { ...port, connector: e.target.value }
                                return { ...prev, ports: next }
                              })
                            }
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-[11px]">来源与槽位</Label>
                          <NativeSelect
                            disabled={!editable}
                            value={port.source_kind}
                            onChange={(e) => {
                              const sk = e.target.value as PortSourceKind
                              patchForm((prev) => {
                                const next = [...prev.ports]
                                next[idx] = {
                                  ...port,
                                  source_kind: sk,
                                  slot_key: sk === "option_slot" ? port.slot_key ?? slotKeys[0] ?? null : null,
                                }
                                return { ...prev, ports: next }
                              })
                            }}
                          >
                            <NativeSelectOption value="fixed">板载固定 (fixed)</NativeSelectOption>
                            <NativeSelectOption value="option_slot">扩展槽位 (option_slot)</NativeSelectOption>
                          </NativeSelect>
                          {port.source_kind === "option_slot" && (
                            <NativeSelect
                              disabled={!editable}
                              value={port.slot_key ?? ""}
                              onChange={(e) =>
                                patchForm((prev) => {
                                  const next = [...prev.ports]
                                  next[idx] = { ...port, slot_key: e.target.value || null }
                                  return { ...prev, ports: next }
                                })
                              }
                            >
                              <NativeSelectOption value="">选择关联槽位</NativeSelectOption>
                              {slotKeys.map((k) => (
                                <NativeSelectOption key={k} value={k}>
                                  {k}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          )}
                        </div>
                        <div className="col-span-6 sm:col-span-2 flex items-end justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <Label className="text-[11px]">速率 (Mbps)</Label>
                            <Input
                              type="number"
                              min={1}
                              disabled={!editable}
                              value={port.speed_mbps ?? ""}
                              onChange={(e) =>
                                patchForm((prev) => {
                                  const next = [...prev.ports]
                                  next[idx] = {
                                    ...port,
                                    speed_mbps: e.target.value ? Math.trunc(Number(e.target.value)) : null,
                                  }
                                  return { ...prev, ports: next }
                                })
                              }
                            />
                          </div>
                          {editable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() =>
                                patchForm((prev) => ({
                                  ...prev,
                                  ports: prev.ports.filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="standard" className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    定义每台设备出厂标配组件及数量（供到货单快速带出计划配置）。发布前每项标配需在「兼容清单」中存在已确认兼容规则。
                  </p>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectableComponentRevOptions.length === 0}
                      onClick={() =>
                        patchForm((prev) => ({
                          ...prev,
                          standard_components: [
                            ...prev.standard_components,
                            {
                              part_model_revision_id: selectableComponentRevOptions[0]?.revision.id ?? "",
                              slot_key: null,
                              quantity: 1,
                              required: true,
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      新增标配组件
                    </Button>
                  )}
                </div>

                {form.standard_components.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    暂无标配组件（{selectableComponentRevOptions.length === 0 ? "请先发布至少一个启用状态的组件型号版本" : "可点击右上角添加"}）
                  </div>
                ) : (
                  <div className="space-y-3">
                    {form.standard_components.map((item, idx) => {
                      const hasConfirmedCompat = form.compatibilities.some(
                        (c) =>
                          c.part_model_revision_id === item.part_model_revision_id &&
                          (c.slot_key ?? null) === (item.slot_key ?? null) &&
                          c.status === "confirmed",
                      )
                      return (
                        <div key={idx} className="grid grid-cols-12 gap-2.5 rounded-lg border p-3 items-end">
                          <div className="col-span-12 md:col-span-5 space-y-1">
                            <Label className="text-[11px]">已发布组件版本 *</Label>
                            <NativeSelect
                              disabled={!editable}
                              value={item.part_model_revision_id}
                              onChange={(e) =>
                                patchForm((prev) => {
                                  const next = [...prev.standard_components]
                                  next[idx] = { ...item, part_model_revision_id: e.target.value }
                                  return { ...prev, standard_components: next }
                                })
                              }
                            >
                              {!selectableComponentRevOptions.some(
                                (o) => o.revision.id === item.part_model_revision_id,
                              ) &&
                                item.part_model_revision_id && (
                                  <NativeSelectOption value={item.part_model_revision_id}>
                                    {componentRevLabelMap.get(item.part_model_revision_id) ?? item.part_model_revision_id}
                                  </NativeSelectOption>
                                )}
                              {selectableComponentRevOptions.map((opt) => (
                                <NativeSelectOption key={opt.revision.id} value={opt.revision.id}>
                                  {opt.label}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </div>

                          <div className="col-span-6 md:col-span-2 space-y-1">
                            <Label className="text-[11px]">指定槽位（可选）</Label>
                            <NativeSelect
                              disabled={!editable}
                              value={item.slot_key ?? ""}
                              onChange={(e) => {
                                const sk = e.target.value || null
                                patchForm((prev) => {
                                  const next = [...prev.standard_components]
                                  next[idx] = {
                                    ...item,
                                    slot_key: sk,
                                    quantity: sk ? 1 : item.quantity,
                                  }
                                  return { ...prev, standard_components: next }
                                })
                              }}
                            >
                              <NativeSelectOption value="">整机汇总（不限槽位）</NativeSelectOption>
                              {slotKeys.map((k) => (
                                <NativeSelectOption key={k} value={k}>
                                  {k}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </div>

                          <div className="col-span-6 md:col-span-2 space-y-1">
                            <Label className="text-[11px]">每台数量 *</Label>
                            <Input
                              type="number"
                              min={1}
                              max={512}
                              disabled={!editable || Boolean(item.slot_key)}
                              value={item.quantity}
                              onChange={(e) =>
                                patchForm((prev) => {
                                  const next = [...prev.standard_components]
                                  next[idx] = { ...item, quantity: Math.max(1, Math.trunc(Number(e.target.value) || 1)) }
                                  return { ...prev, standard_components: next }
                                })
                              }
                            />
                          </div>

                          <div className="col-span-12 md:col-span-3 flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-1.5 text-xs">
                              <Checkbox
                                checked={item.required}
                                disabled={!editable}
                                onCheckedChange={(checked) =>
                                  patchForm((prev) => {
                                    const next = [...prev.standard_components]
                                    next[idx] = { ...item, required: Boolean(checked) }
                                    return { ...prev, standard_components: next }
                                  })
                                }
                              />
                              必配
                            </label>

                            {hasConfirmedCompat ? (
                              <Badge variant="outline" className="text-[11px] text-emerald-600 border-emerald-500/40">
                                <CheckCircle2 className="mr-1 size-3" />
                                已兼容
                              </Badge>
                            ) : (
                              editable && (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="secondary"
                                  onClick={() =>
                                    ensureConfirmedCompatibility(item.part_model_revision_id, item.slot_key ?? null)
                                  }
                                >
                                  确认兼容
                                </Button>
                              )
                            )}

                            {editable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() =>
                                  patchForm((prev) => ({
                                    ...prev,
                                    standard_components: prev.standard_components.filter((_, i) => i !== idx),
                                  }))
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="compat" className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    标记设备版本与组件版本之间的兼容性（已确认兼容需填写验证依据）。
                  </p>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectableComponentRevOptions.length === 0}
                      onClick={() =>
                        patchForm((prev) => ({
                          ...prev,
                          compatibilities: [
                            ...prev.compatibilities,
                            {
                              part_model_revision_id: selectableComponentRevOptions[0]?.revision.id ?? "",
                              slot_key: null,
                              status: "confirmed",
                              evidence_note: "原厂兼容列表核验通过",
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      新增兼容规则
                    </Button>
                  )}
                </div>

                {form.compatibilities.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    暂无兼容性规则
                  </div>
                ) : (
                  <div className="space-y-3">
                    {form.compatibilities.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2.5 rounded-lg border p-3 items-end">
                        <div className="col-span-12 md:col-span-4 space-y-1">
                          <Label className="text-[11px]">组件版本 *</Label>
                          <NativeSelect
                            disabled={!editable}
                            value={item.part_model_revision_id}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.compatibilities]
                                next[idx] = { ...item, part_model_revision_id: e.target.value }
                                return { ...prev, compatibilities: next }
                              })
                            }
                          >
                            {!selectableComponentRevOptions.some(
                              (o) => o.revision.id === item.part_model_revision_id,
                            ) &&
                              item.part_model_revision_id && (
                                <NativeSelectOption value={item.part_model_revision_id}>
                                  {componentRevLabelMap.get(item.part_model_revision_id) ?? item.part_model_revision_id}
                                </NativeSelectOption>
                              )}
                            {selectableComponentRevOptions.map((opt) => (
                              <NativeSelectOption key={opt.revision.id} value={opt.revision.id}>
                                {opt.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>

                        <div className="col-span-6 md:col-span-2 space-y-1">
                          <Label className="text-[11px]">限定槽位</Label>
                          <NativeSelect
                            disabled={!editable}
                            value={item.slot_key ?? ""}
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.compatibilities]
                                next[idx] = { ...item, slot_key: e.target.value || null }
                                return { ...prev, compatibilities: next }
                              })
                            }
                          >
                            <NativeSelectOption value="">通用（不限槽位）</NativeSelectOption>
                            {slotKeys.map((k) => (
                              <NativeSelectOption key={k} value={k}>
                                {k}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>

                        <div className="col-span-6 md:col-span-2 space-y-1">
                          <Label className="text-[11px]">兼容状态</Label>
                          {editable ? (
                            <NativeSelect
                              value={item.status}
                              onChange={(e) =>
                                patchForm((prev) => {
                                  const next = [...prev.compatibilities]
                                  next[idx] = { ...item, status: e.target.value as CompatibilityStatus }
                                  return { ...prev, compatibilities: next }
                                })
                              }
                            >
                              <NativeSelectOption value="confirmed">已确认兼容</NativeSelectOption>
                              <NativeSelectOption value="pending">待验证</NativeSelectOption>
                              <NativeSelectOption value="incompatible">不兼容</NativeSelectOption>
                            </NativeSelect>
                          ) : (
                            <div className="pt-1">
                              <AssetStatusBadge state={item.status} />
                            </div>
                          )}
                        </div>

                        <div className="col-span-10 md:col-span-3 space-y-1">
                          <Label className="text-[11px]">
                            验证依据说明 {item.status === "confirmed" ? "*" : ""}
                          </Label>
                          <Input
                            disabled={!editable}
                            value={item.evidence_note}
                            placeholder="如 厂商 HCL 文档 / 样机验证"
                            onChange={(e) =>
                              patchForm((prev) => {
                                const next = [...prev.compatibilities]
                                next[idx] = { ...item, evidence_note: e.target.value }
                                return { ...prev, compatibilities: next }
                              })
                            }
                          />
                        </div>

                        <div className="col-span-2 md:col-span-1 flex justify-end">
                          {editable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() =>
                                patchForm((prev) => ({
                                  ...prev,
                                  compatibilities: prev.compatibilities.filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </ModelRevisionShell>

      <ReceivingHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="设备型号"
        recordLabel={model?.name}
        recordId={id}
        queryKey={(page) => queryKeys.deviceModelHistory(id, page)}
        fetchHistory={(targetId, params, signal) => deviceModelsService.history(targetId, params, signal)}
      />
    </>
  )
}
