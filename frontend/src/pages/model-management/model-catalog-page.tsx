import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Cpu, Eye, History, Pencil, Plus, Server, Trash2 } from "lucide-react"
import {
  DataTable,
  DataTableCard,
  DataTableTitle,
  createActionsColumn,
  type ColumnDef,
} from "@/components/data-table"
import { useConfirm } from "@/components/common/confirm-dialog"
import { PageHeader } from "@/components/common/page-header"
import {
  AssetStatusBadge,
  filterManufacturers,
  formatSpecSummary,
  labelComponentKind,
  labelDeviceCategory,
  useCompanyOptions,
  useReceivingMetadata,
} from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getErrorMessage, isVersionConflict } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { createIdempotencyKey } from "@/services/receiving-metadata"
import {
  componentModelsService,
  deviceModelsService,
  type CatalogModelDTO,
} from "@/services/receiving-models"
import { useAuth } from "@/stores/auth-context"

export type CatalogMode = "component" | "device"

export function ModelCatalogPage({ mode }: { mode: CatalogMode }) {
  const isComponent = mode === "component"
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()

  const permPrefix = isComponent ? "model-management:component-models" : "model-management:device-models"
  const canRead = can(`${permPrefix}:read`)
  const canCreate = can(`${permPrefix}:create`)
  const canUpdate = can(`${permPrefix}:update`)
  const canToggleStatus = can(`${permPrefix}:status`)
  const canDelete = can(`${permPrefix}:delete`)
  const canHistory = can(`${permPrefix}:history`)

  const service = isComponent ? componentModelsService : deviceModelsService
  const listKey = isComponent ? queryKeys.componentModels : queryKeys.deviceModels
  const allKey = isComponent ? queryKeys.componentModelsAll : queryKeys.deviceModelsAll
  const baseRoute = isComponent ? "/model-management/component-models" : "/model-management/device-models"

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [manufacturerFilter, setManufacturerFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "1" | "2">("all")

  const [formTarget, setFormTarget] = useState<CatalogModelDTO | "new" | null>(null)
  const [historyTarget, setHistoryTarget] = useState<CatalogModelDTO | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const metadataQuery = useReceivingMetadata(canRead)
  const companiesQuery = useCompanyOptions(canRead)
  const manufacturers = useMemo(
    () => filterManufacturers(companiesQuery.data?.data.items ?? []),
    [companiesQuery.data],
  )
  const manufacturerMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of companiesQuery.data?.data.items ?? []) {
      map.set(c.id, c.name)
    }
    return map
  }, [companiesQuery.data])

  const queryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      manufacturer_id: manufacturerFilter === "all" ? undefined : manufacturerFilter,
      kind: isComponent && typeFilter !== "all" ? typeFilter : undefined,
      category: !isComponent && typeFilter !== "all" ? typeFilter : undefined,
      status: statusFilter === "all" ? undefined : Number(statusFilter),
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    [debouncedSearch, manufacturerFilter, isComponent, typeFilter, statusFilter, pagination],
  )

  const listQuery = useQuery({
    queryKey: listKey(queryParams),
    queryFn: ({ signal }) => service.list(queryParams, signal),
    enabled: canRead,
  })

  const statusMutation = useMutation({
    mutationFn: ({ record, nextStatus }: { record: CatalogModelDTO; nextStatus: number }) =>
      service.setStatus(record.id, record.version, nextStatus),
    onSuccess: (_res, vars) => {
      notify.success(`型号已${vars.nextStatus === 1 ? "启用" : "停用"}`)
      queryClient.invalidateQueries({ queryKey: allKey })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectableDeviceModels })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectableDeviceRevisionsAll })
      queryClient.invalidateQueries({
        queryKey: isComponent ? queryKeys.publishedComponentRevisions : queryKeys.publishedDeviceRevisions,
      })
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        notify.warning("型号版本已变化，列表已为您刷新，请核对后重试")
        queryClient.invalidateQueries({ queryKey: allKey })
        return
      }
      notify.error(getErrorMessage(err, "变更状态失败"))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (record: CatalogModelDTO) => service.remove(record.id, record.version),
    onSuccess: () => {
      notify.success("型号已删除")
      queryClient.invalidateQueries({ queryKey: allKey })
    },
    onError: (err) => {
      notify.error(getErrorMessage(err, "删除型号失败（可能仍存在修订版本或引用）"))
    },
  })

  const handleDelete = useCallback(
    async (record: CatalogModelDTO) => {
      let refMsg = ""
      try {
        const refs = await service.references(record.id)
        if (refs.data.revisions > 0) {
          refMsg = `该型号当前还有 ${refs.data.revisions} 个修订版本，请先在详情页清理草稿版本或停用型号。`
        }
      } catch {
        // Ignore reference check fallback; backend delete enforces consistency.
      }
      if (refMsg) {
        notify.warning(refMsg)
        return
      }
      await confirm({
        title: `删除${isComponent ? "组件" : "设备"}型号「${record.name}」`,
        description: "仅未关联修订版本或单据的型号允许删除，此操作不可撤销。",
        confirmText: "确认删除",
        tone: "destructive",
        onConfirm: () => deleteMutation.mutateAsync(record),
      })
    },
    [confirm, deleteMutation, isComponent, service],
  )

  const columns = useMemo<ColumnDef<CatalogModelDTO>[]>(
    () => [
      {
        accessorKey: "name",
        header: isComponent ? "组件型号名称" : "设备型号名称",
        cell: ({ row }) => {
          const item = row.original
          const code = isComponent ? item.part_no : item.model_name
          return (
            <div className="min-w-0">
              <button
                type="button"
                className="font-medium text-primary hover:underline text-left truncate block max-w-64"
                onClick={() => navigate(`${baseRoute}/${item.id}`)}
              >
                {item.name}
              </button>
              <div className="text-[11px] font-mono text-muted-foreground">{code || "—"}</div>
            </div>
          )
        },
      },
      {
        id: "manufacturer",
        header: "制造商",
        cell: ({ row }) => (
          <span className="text-xs">{manufacturerMap.get(row.original.manufacturer_id) ?? row.original.manufacturer_id}</span>
        ),
      },
      {
        id: "type_kind",
        header: isComponent ? "组件类别" : "设备类别",
        cell: ({ row }) => (
          <span className="text-xs">
            {isComponent ? labelComponentKind(row.original.kind) : labelDeviceCategory(row.original.category)}
          </span>
        ),
      },
      {
        id: "latest_revision",
        header: "已发布版本",
        cell: ({ row }) => {
          const rev = row.original.latest_published_revision
          if (!rev) {
            return <span className="text-xs text-muted-foreground">暂无已发布版本</span>
          }
          return (
            <div className="space-y-0.5 text-xs">
              <div className="flex items-center gap-1.5">
                <AssetStatusBadge state="published" customLabel={`v${rev.revision_no} 已发布`} />
              </div>
              <div className="text-[11px] text-muted-foreground truncate max-w-56">
                {formatSpecSummary(rev.spec)}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className="flex items-center gap-2">
              {canToggleStatus ? (
                <Switch
                  checked={item.status === 1}
                  disabled={statusMutation.isPending}
                  aria-label={`切换 ${item.name} 启停状态`}
                  onCheckedChange={(checked) =>
                    statusMutation.mutate({ record: item, nextStatus: checked ? 1 : 2 })
                  }
                />
              ) : (
                <AssetStatusBadge state={item.status} />
              )}
            </div>
          )
        },
      },
      {
        accessorKey: "updated_at",
        header: "更新时间",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updated_at)}</span>
        ),
      },
      createActionsColumn<CatalogModelDTO>({
        actions: (item) => [
          {
            key: "detail",
            label: "版本与详情",
            icon: <Eye />,
            onSelect: () => navigate(`${baseRoute}/${item.id}`),
          },
          {
            key: "edit",
            label: "编辑基本信息",
            icon: <Pencil />,
            hidden: !canUpdate,
            onSelect: () => setFormTarget(item),
          },
          {
            key: "history",
            label: "操作历史",
            icon: <History />,
            hidden: !canHistory,
            onSelect: () => setHistoryTarget(item),
          },
          {
            key: "delete",
            label: "删除型号",
            icon: <Trash2 />,
            destructive: true,
            hidden: !canDelete,
            onSelect: () => void handleDelete(item),
          },
        ],
      }),
    ],
    [
      baseRoute,
      canDelete,
      canHistory,
      canToggleStatus,
      canUpdate,
      handleDelete,
      isComponent,
      manufacturerMap,
      navigate,
      statusMutation,
    ],
  )

  const metadata = metadataQuery.data?.data
  const typeOptions = isComponent ? metadata?.component_kinds ?? [] : metadata?.device_categories ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title={isComponent ? "组件型号管理" : "设备型号管理"}
        description={
          isComponent
            ? "维护可追踪组件型号及规格版本，已发布版本供设备标配与采购到货使用。"
            : "维护设备型号、机架形态、槽位/端口模板与标配兼容清单。"
        }
        icon={isComponent ? Cpu : Server}
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setFormTarget("new")}>
              <Plus className="mr-1.5 size-4" />
              新建{isComponent ? "组件" : "设备"}型号
            </Button>
          )
        }
      />

      <DataTableCard
        title={<DataTableTitle title={isComponent ? "组件型号目录" : "设备型号目录"} count={listQuery.data?.data.total} />}
        isPlaceholderData={listQuery.isPlaceholderData}
        error={listQuery.error}
        hasData={Boolean(listQuery.data)}
        onRetry={() => void listQuery.refetch()}
        retrying={listQuery.isFetching}
      >
        <DataTable
          columns={columns}
          data={listQuery.data?.data.items ?? []}
          loading={listQuery.isLoading}
          getRowId={(r) => r.id}
          serverFiltering
          externalSearch={{
            value: search,
            onChange: (val) => {
              setSearch(val)
              setPagination((p) => ({ ...p, pageIndex: 0 }))
            },
          }}
          serverPagination={{
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
            total: listQuery.data?.data.total ?? 0,
            onChange: setPagination,
          }}
          searchPlaceholder={isComponent ? "搜索组件名称或料号 (Part No)..." : "搜索设备名称或型号代码..."}
          onRefresh={() => void listQuery.refetch()}
          isRefreshing={listQuery.isFetching}
          searchTrailing={
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="按制造商筛选"
                value={manufacturerFilter}
                onChange={(e) => {
                  setManufacturerFilter(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部制造商</NativeSelectOption>
                {manufacturers.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>

              <NativeSelect
                aria-label={isComponent ? "按组件类别筛选" : "按设备类别筛选"}
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">{isComponent ? "全部组件类别" : "全部设备类别"}</NativeSelectOption>
                {typeOptions.map((opt) => (
                  <NativeSelectOption key={opt} value={opt}>
                    {isComponent ? labelComponentKind(opt) : labelDeviceCategory(opt)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>

              <NativeSelect
                aria-label="按启停状态筛选"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as "all" | "1" | "2")
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部状态</NativeSelectOption>
                <NativeSelectOption value="1">启用</NativeSelectOption>
                <NativeSelectOption value="2">停用</NativeSelectOption>
              </NativeSelect>
            </div>
          }
        />
      </DataTableCard>

      <ModelFormDialog
        mode={mode}
        target={formTarget}
        onOpenChange={(open) => !open && setFormTarget(null)}
        manufacturers={manufacturers}
        typeOptions={typeOptions}
        onSuccess={(created) => {
          queryClient.invalidateQueries({ queryKey: allKey })
          if (created && formTarget === "new") {
            navigate(`${baseRoute}/${created.id}`)
          }
        }}
      />

      <ReceivingHistorySheet
        open={Boolean(historyTarget)}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        title={isComponent ? "组件型号" : "设备型号"}
        recordLabel={historyTarget?.name}
        recordId={historyTarget?.id}
        queryKey={(page) =>
          isComponent
            ? queryKeys.componentModelHistory(historyTarget?.id ?? "", page)
            : queryKeys.deviceModelHistory(historyTarget?.id ?? "", page)
        }
        fetchHistory={(id, params, signal) => service.history(id, params, signal)}
      />
    </div>
  )
}

function ModelFormDialog({
  mode,
  target,
  onOpenChange,
  manufacturers,
  typeOptions,
  onSuccess,
}: {
  mode: CatalogMode
  target: CatalogModelDTO | "new" | null
  onOpenChange: (open: boolean) => void
  manufacturers: Array<{ id: string; name: string }>
  typeOptions: string[]
  onSuccess: (record?: CatalogModelDTO) => void
}) {
  const isComponent = mode === "component"
  const isNew = target === "new"
  const editing = target && target !== "new" ? target : null

  const [manufacturerId, setManufacturerId] = useState("")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [kindOrCategory, setKindOrCategory] = useState("")
  const [description, setDescription] = useState("")
  const [idemKey, setIdemKey] = useState(() => createIdempotencyKey("model"))

  useEffect(() => {
    if (!target) return
    if (isNew) {
      setManufacturerId(manufacturers[0]?.id ?? "")
      setName("")
      setCode("")
      setKindOrCategory(typeOptions[0] ?? "")
      setDescription("")
      setIdemKey(createIdempotencyKey("model"))
    } else if (editing) {
      setManufacturerId(editing.manufacturer_id)
      setName(editing.name)
      setCode((isComponent ? editing.part_no : editing.model_name) ?? "")
      setKindOrCategory((isComponent ? editing.kind : editing.category) ?? "")
      setDescription(editing.description ?? "")
    }
  }, [target, isNew, editing, isComponent, manufacturers, typeOptions])

  const mutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        if (isComponent) {
          return componentModelsService.create(
            {
              manufacturer_id: manufacturerId,
              name: name.trim(),
              part_no: code.trim(),
              kind: kindOrCategory,
              description: description.trim(),
            },
            idemKey,
          )
        }
        return deviceModelsService.create(
          {
            manufacturer_id: manufacturerId,
            name: name.trim(),
            model_name: code.trim(),
            category: kindOrCategory,
            description: description.trim(),
          },
          idemKey,
        )
      }
      if (!editing) throw new Error("missing target")
      const svc = isComponent ? componentModelsService : deviceModelsService
      return svc.update(editing.id, editing.version, {
        name: name.trim(),
        description: description.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(isNew ? "型号创建成功，可继续新建并发布版本" : "型号基本信息已更新")
      onOpenChange(false)
      onSuccess(res.data)
    },
    onError: (err) => {
      notify.error(getErrorMessage(err, isNew ? "创建型号失败" : "更新型号失败"))
    },
  })

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNew ? `新建${isComponent ? "组件" : "设备"}型号` : `编辑${isComponent ? "组件" : "设备"}型号`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isNew
              ? "创建后请进入详情页新建草稿版本，维护规格参数并发布版本。"
              : "已创建型号仅支持修改展示名称与说明；制造商、料号/型号及类别不可更改。"}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) {
              notify.warning("请输入型号名称")
              return
            }
            if (isNew && (!manufacturerId || !code.trim() || !kindOrCategory)) {
              notify.warning("请完整选择制造商、类别并填写编码")
              return
            }
            mutation.mutate()
          }}
        >
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 sm:col-span-6 space-y-1.5">
              <Label htmlFor="model-manufacturer" className="text-xs">
                制造商 *
              </Label>
              <NativeSelect
                id="model-manufacturer"
                disabled={!isNew || mutation.isPending}
                value={manufacturerId}
                onChange={(e) => setManufacturerId(e.target.value)}
              >
                <NativeSelectOption value="">请选择制造商</NativeSelectOption>
                {manufacturers.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="col-span-12 sm:col-span-6 space-y-1.5">
              <Label htmlFor="model-type" className="text-xs">
                {isComponent ? "组件类别 *" : "设备类别 *"}
              </Label>
              <NativeSelect
                id="model-type"
                disabled={!isNew || mutation.isPending}
                value={kindOrCategory}
                onChange={(e) => setKindOrCategory(e.target.value)}
              >
                <NativeSelectOption value="">请选择类别</NativeSelectOption>
                {typeOptions.map((opt) => (
                  <NativeSelectOption key={opt} value={opt}>
                    {isComponent ? labelComponentKind(opt) : labelDeviceCategory(opt)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="col-span-12 sm:col-span-6 space-y-1.5">
              <Label htmlFor="model-name" className="text-xs">
                显示名称 *
              </Label>
              <Input
                id="model-name"
                value={name}
                disabled={mutation.isPending}
                placeholder={isComponent ? "如 三星 64GB DDR5 ECC RDIMM" : "如 Dell PowerEdge R760"}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="col-span-12 sm:col-span-6 space-y-1.5">
              <Label htmlFor="model-code" className="text-xs">
                {isComponent ? "料号 (Part No) *" : "型号代码 (Model Name) *"}
              </Label>
              <Input
                id="model-code"
                value={code}
                disabled={!isNew || mutation.isPending}
                placeholder={isComponent ? "如 M321R8GA0BB0-CQK" : "如 PowerEdge R760"}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            <div className="col-span-12 space-y-1.5">
              <Label htmlFor="model-desc" className="text-xs">
                说明
              </Label>
              <Textarea
                id="model-desc"
                rows={3}
                value={description}
                disabled={mutation.isPending}
                placeholder="可选填写产品描述、采购备注或适用代际"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "保存中..." : isNew ? "创建并进入版本管理" : "保存更新"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
