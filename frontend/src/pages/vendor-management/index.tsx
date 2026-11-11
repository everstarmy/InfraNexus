import { CertificationsSheet } from "./components/certifications-sheet"
import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Building2,
  FileBadge,
  Plus,
  Pencil,
  Trash2,
  History,
  Link2,
  ExternalLink,
  ShieldCheck,
  Globe,
  Phone,
  Eye,
} from "lucide-react"
import { DataTable, DataTableCard, DataTableTitle, createActionsColumn, type ColumnDef } from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useConfirm } from "@/components/common/confirm-dialog"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { PageHeader } from "@/components/common/page-header"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { getErrorMessage } from "@/lib/api-error"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useAuth } from "@/stores/auth-context"
import {
  manufacturersService,
  vendorsService,
  type ManufacturerDTO,
  type VendorDTO,
  type VendorServiceType,
} from "@/services/vendor-management"
import { ManufacturerFormDialog } from "./components/manufacturer-form-dialog"
import { VendorFormDialog } from "./components/vendor-form-dialog"
import { VendorDetailSheet } from "./components/vendor-detail-sheet"
import { ManagedHistorySheet } from "@/components/managed/managed-history-sheet"
import { ManagedReferencesDialog } from "@/components/managed/managed-references-dialog"

const serviceTypeLabels: Record<VendorServiceType, string> = {
  hardware_supplier: "硬件供货",
  oem_service: "原厂维保",
  third_party_maintenance: "第三方维保",
  spare_parts: "备件支持",
  data_destruction: "介质销毁",
}

export default function VendorManagementPage() {
  const { can } = useAuth()
  const [certificationsOpen, setCertificationsOpen] = useState(false)
  const canReadManufacturers = can("vendor-management:manufacturers:read")
  const canReadVendors = can("vendor-management:vendors:read")
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<"manufacturers" | "vendors">("manufacturers")

  // Search & Pagination for Manufacturers
  const [mfrSearch, setMfrSearch] = useState("")
  const debouncedMfrSearch = useDebouncedValue(mfrSearch.trim(), 250)
  const [mfrPagination, setMfrPagination] = useState({ pageIndex: 0, pageSize: 20 })

  // Search & Pagination for Vendors
  const [vendorSearch, setVendorSearch] = useState("")
  const debouncedVendorSearch = useDebouncedValue(vendorSearch.trim(), 250)
  const [vendorPagination, setVendorPagination] = useState({ pageIndex: 0, pageSize: 20 })

  // Dialog & Sheet States
  const [mfrForm, setMfrForm] = useState<ManufacturerDTO | "new" | null>(null)
  const [vendorForm, setVendorForm] = useState<VendorDTO | "new" | null>(null)
  const [vendorDetail, setVendorDetail] = useState<VendorDTO | null>(null)

  // Audit History & References Modals
  const [historyTarget, setHistoryTarget] = useState<{
    id: string
    name: string
    title: string
    fetch: typeof manufacturersService.history
  } | null>(null)

  const [refTarget, setRefTarget] = useState<{
    id: string
    name: string
    title: string
    fetch: typeof manufacturersService.references
  } | null>(null)

  // Fetch Manufacturers
  const mfrQuery = useQuery({
    enabled: canReadManufacturers,
    queryKey: ["manufacturers", mfrPagination.pageIndex, mfrPagination.pageSize, debouncedMfrSearch],
    queryFn: ({ signal }) =>
      manufacturersService.list(
        {
          page: mfrPagination.pageIndex + 1,
          page_size: mfrPagination.pageSize,
          search: debouncedMfrSearch || undefined,
        },
        signal
      ),
  })

  // Fetch Vendors
  const vendorQuery = useQuery({
    enabled: canReadVendors,
    queryKey: ["vendors", vendorPagination.pageIndex, vendorPagination.pageSize, debouncedVendorSearch],
    queryFn: ({ signal }) =>
      vendorsService.list(
        {
          page: vendorPagination.pageIndex + 1,
          page_size: vendorPagination.pageSize,
          search: debouncedVendorSearch || undefined,
        },
        signal
      ),
  })

  const manufacturers = mfrQuery.data?.data.items ?? []
  const mfrTotal = mfrQuery.data?.data.total ?? 0

  const vendors = vendorQuery.data?.data.items ?? []
  const vendorTotal = vendorQuery.data?.data.total ?? 0

  // Toggle Manufacturer Status
  const toggleMfrStatus = async (m: ManufacturerDTO, enabled: boolean) => {
    try {
      await manufacturersService.setStatus(m.id, m.version, enabled ? 1 : 2)
      notify.success(enabled ? "已启用制造商" : "已停用制造商", m.name)
      void queryClient.invalidateQueries({ queryKey: ["manufacturers"] })
    } catch (err) {
      notify.error("变更状态失败", getErrorMessage(err))
    }
  }

  // Toggle Vendor Status
  const toggleVendorStatus = async (v: VendorDTO, enabled: boolean) => {
    try {
      await vendorsService.setStatus(v.id, v.version, enabled ? 1 : 2)
      notify.success(enabled ? "已启用供应商" : "已停用供应商", v.name)
      void queryClient.invalidateQueries({ queryKey: ["vendors"] })
    } catch (err) {
      notify.error("变更状态失败", getErrorMessage(err))
    }
  }

  // Delete Manufacturer
  const deleteManufacturer = async (m: ManufacturerDTO) => {
    const ok = await confirm({
      tone: "destructive",
      title: `删除制造商「${m.name}」？`,
      description: "受外键引用的制造商无法删除，若存在已有关联数据请选择停用。",
      confirmText: "确认删除",
    })
    if (!ok) return
    try {
      await manufacturersService.remove(m.id, m.version)
      notify.success("制造商已删除", m.name)
      void queryClient.invalidateQueries({ queryKey: ["manufacturers"] })
    } catch (err) {
      notify.error("删除失败", getErrorMessage(err))
    }
  }

  // Delete Vendor
  const deleteVendor = async (v: VendorDTO) => {
    const ok = await confirm({
      tone: "destructive",
      title: `删除供应商「${v.name}」？`,
      description: "受维保合同、资质及实物引用的供应商无法直接删除，若存在历史业务建议切换为终止合作。",
      confirmText: "确认删除",
    })
    if (!ok) return
    try {
      await vendorsService.remove(v.id, v.version)
      notify.success("供应商已删除", v.name)
      void queryClient.invalidateQueries({ queryKey: ["vendors"] })
    } catch (err) {
      notify.error("删除失败", getErrorMessage(err))
    }
  }

  // Columns for Manufacturers
  const mfrColumns = useMemo<ColumnDef<ManufacturerDTO>[]>(() => [
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="制造商名称" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{row.original.name}</span>
          {row.original.english_name && (
            <span className="text-[11px] text-muted-foreground">{row.original.english_name}</span>
          )}
        </div>
      ),
    },
    {
      id: "code",
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="厂商编码" />,
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.code}
        </Badge>
      ),
    },
    {
      id: "enterprise_oid",
      accessorKey: "enterprise_oid",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Enterprise OID" />,
      cell: ({ row }) =>
        row.original.enterprise_oid ? (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.enterprise_oid}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
    },
    {
      id: "protocols",
      accessorKey: "protocols",
      header: ({ column }) => <DataTableColumnHeader column={column} title="采集协议" />,
      cell: ({ row }) => {
        const protos = row.original.protocols ?? []
        if (protos.length === 0) return <span className="text-muted-foreground/40">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {protos.map((p) => (
              <Badge key={p} variant="secondary" className="text-[10px] uppercase font-mono px-1 py-0">
                {p}
              </Badge>
            ))}
          </div>
        )
      },
    },
    {
      id: "support_phone",
      accessorKey: "support_phone",
      header: ({ column }) => <DataTableColumnHeader column={column} title="服务热线 / 门户" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-xs">
          {row.original.support_phone && (
            <span className="flex items-center gap-1 font-mono text-muted-foreground">
              <Phone className="size-3 text-primary" />
              {row.original.support_phone}
            </span>
          )}
          {row.original.support_url && (
            <a
              href={row.original.support_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center"
              title="支持门户"
            >
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
      cell: ({ row }) => (
        <Switch
          checked={row.original.status === 1}
          disabled={!can("vendor-management:manufacturers:status")}
          onCheckedChange={(checked) => void toggleMfrStatus(row.original, checked)}
          aria-label="切换状态"
        />
      ),
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title="更新时间" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updated_at)}</span>
      ),
    },
    createActionsColumn<ManufacturerDTO>({
      actions: (row) => [
        {
          key: "edit",
          label: "编辑制造商",
          icon: <Pencil className="size-4" />,
          hidden: !can("vendor-management:manufacturers:update"),
          onSelect: () => setMfrForm(row),
        },
        {
          key: "references",
          label: "查看引用",
          icon: <Link2 className="size-4" />,
          onSelect: () =>
            setRefTarget({
              id: row.id,
              name: row.name,
              title: "制造商",
              fetch: manufacturersService.references,
            }),
        },
        {
          key: "history",
          label: "变更历史",
          icon: <History className="size-4" />,
          hidden: !can("vendor-management:manufacturers:history"),
          onSelect: () =>
            setHistoryTarget({
              id: row.id,
              name: row.name,
              title: "制造商",
              fetch: manufacturersService.history,
            }),
        },
        {
          key: "delete",
          label: "删除",
          icon: <Trash2 className="size-4" />,
          destructive: true,
          hidden: !can("vendor-management:manufacturers:delete"),
          onSelect: () => void deleteManufacturer(row),
        },
      ],
    }),
  ], [can])

  // Columns for Vendors
  const vendorColumns = useMemo<ColumnDef<VendorDTO>[]>(() => [
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="供应商全称 / 简称" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <button
            type="button"
            className="font-medium text-foreground text-left hover:text-primary transition-colors cursor-pointer"
            onClick={() => setVendorDetail(row.original)}
          >
            {row.original.name}
          </button>
          {row.original.short_name && (
            <span className="text-[11px] text-muted-foreground font-sans">
              简称：{row.original.short_name}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "credit_code",
      accessorKey: "credit_code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="信用代码" />,
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.credit_code}
        </Badge>
      ),
    },
    {
      id: "service_types",
      accessorKey: "service_types",
      header: ({ column }) => <DataTableColumnHeader column={column} title="服务范围" />,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {row.original.service_types.map((st) => (
            <Badge key={st} variant="secondary" className="text-[10px] px-1 py-0">
              {serviceTypeLabels[st] ?? st}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "cooperation_status",
      accessorKey: "cooperation_status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="合作状态" />,
      cell: ({ row }) => {
        const s = row.original.cooperation_status
        return (
          <Badge
            variant="outline"
            className={
              s === "active"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : s === "suspended"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }
          >
            {s === "active" ? "正常合作" : s === "suspended" ? "已暂停" : "已终止"}
          </Badge>
        )
      },
    },
    {
      id: "emergency_phone",
      accessorKey: "emergency_phone",
      header: ({ column }) => <DataTableColumnHeader column={column} title="紧急报修电话" />,
      cell: ({ row }) =>
        row.original.emergency_phone ? (
          <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <Phone className="size-3 text-primary" />
            {row.original.emergency_phone}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="系统启用" />,
      cell: ({ row }) => (
        <Switch
          checked={row.original.status === 1}
          disabled={!can("vendor-management:vendors:status")}
          onCheckedChange={(checked) => void toggleVendorStatus(row.original, checked)}
          aria-label="切换状态"
        />
      ),
    },
    createActionsColumn<VendorDTO>({
      actions: (row) => [
        {
          key: "detail",
          label: "资质与联系人",
          icon: <Eye className="size-4" />,
          onSelect: () => setVendorDetail(row),
        },
        {
          key: "edit",
          label: "编辑资料",
          icon: <Pencil className="size-4" />,
          hidden: !can("vendor-management:vendors:update"),
          onSelect: () => setVendorForm(row),
        },
        {
          key: "references",
          label: "查看引用",
          icon: <Link2 className="size-4" />,
          onSelect: () =>
            setRefTarget({
              id: row.id,
              name: row.name,
              title: "供应商",
              fetch: vendorsService.references,
            }),
        },
        {
          key: "history",
          label: "变更历史",
          icon: <History className="size-4" />,
          hidden: !can("vendor-management:vendors:history"),
          onSelect: () =>
            setHistoryTarget({
              id: row.id,
              name: row.name,
              title: "供应商",
              fetch: vendorsService.history,
            }),
        },
        {
          key: "delete",
          label: "删除",
          icon: <Trash2 className="size-4" />,
          destructive: true,
          hidden: !can("vendor-management:vendors:delete"),
          onSelect: () => void deleteVendor(row),
        },
      ],
    }),
  ], [can])

  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <PageHeader
        title="制造商与供应商"
        description="原厂设备制造商标准档案、第三方维保供应商资质与应急响应 SLA"
        icon={Building2}
        actions={can(["vendor-management:contact-certifications:read", "vendor-management:contact-certifications:create"]) && (
          <Button variant="outline" size="sm" onClick={() => setCertificationsOpen(true)}>联系人证书</Button>
        )}
      />

      <StatGrid>
        <StatCard
          label="设备制造商"
          value={mfrTotal}
          icon={Building2}
          tone="primary"
          hint="硬件与原厂技术支持"
        />
        <StatCard
          label="签约供应商 / 服务商"
          value={vendorTotal}
          icon={ShieldCheck}
          tone="info"
          hint="供货、维保与备件支持"
        />
        <StatCard
          label="正常合作中服务商（本页）"
          value={vendors.filter((v) => v.cooperation_status === "active").length}
          icon={Globe}
          tone="success"
          hint="具备有效签约与 SLA"
        />
        <StatCard
          label="停用记录 (本页)"
          value={
            activeTab === "manufacturers"
              ? manufacturers.filter((m) => m.status !== 1).length
              : vendors.filter((v) => v.status !== 1).length
          }
          icon={FileBadge}
          tone="default"
          hint="不可创建新业务引用"
        />
      </StatGrid>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="table-workspace-body flex flex-col min-h-0 flex-1 gap-2">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="manufacturers" className="gap-2">
            <Building2 className="size-4" />
            制造商档案 ({mfrTotal})
          </TabsTrigger>
          <TabsTrigger value="vendors" className="gap-2">
            <ShieldCheck className="size-4" />
            供应商与服务商 ({vendorTotal})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manufacturers" className="flex-1 min-h-0 flex flex-col mt-0 data-[state=inactive]:hidden">
          <DataTableCard
            className="flex-1 min-h-0"
            label="制造商列表"
            title={<DataTableTitle title="制造商档案" count={mfrTotal} />}
            actions={<>
              {can("vendor-management:manufacturers:create") && (
                <Button
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => setMfrForm("new")}
                >
                  <Plus className="size-3.5" />
                  新建制造商
                </Button>
              )}
            </>}
            error={mfrQuery.error}
            onRetry={() => void mfrQuery.refetch()}
            hasData={Boolean(mfrQuery.data)}
          >
            <DataTable emptyTitle={canReadManufacturers ? undefined : "没有查看制造商的权限"}
              viewport={{
                mode: "fill",
                mobileContent: true,
                pending: mfrQuery.isPlaceholderData,
                queryKey: JSON.stringify([mfrPagination, debouncedMfrSearch]),
              }}
              layoutControls={{ density: true, fullscreen: true }}
              columns={mfrColumns}
              data={canReadManufacturers ? manufacturers : []}
              loading={mfrQuery.isLoading}
              getRowId={(r) => r.id}
              externalSearch={{ value: mfrSearch, onChange: (value) => { setMfrSearch(value); setMfrPagination((current) => ({ ...current, pageIndex: 0 })) } }}
              serverFiltering
              serverPagination={{
                pageIndex: mfrPagination.pageIndex,
                pageSize: mfrPagination.pageSize,
                total: mfrTotal,
                onChange: setMfrPagination,
              }}
              defaultPageSize={20}
            />
          </DataTableCard>
        </TabsContent>

        <TabsContent value="vendors" className="flex-1 min-h-0 flex flex-col mt-0 data-[state=inactive]:hidden">
          <DataTableCard
            className="flex-1 min-h-0"
            label="供应商列表"
            title={<DataTableTitle title="供应商与服务商" count={vendorTotal} />}
            actions={<>
              {can("vendor-management:vendors:create") && (
                <Button
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => setVendorForm("new")}
                >
                  <Plus className="size-3.5" />
                  新建供应商
                </Button>
              )}
            </>}
            error={vendorQuery.error}
            onRetry={() => void vendorQuery.refetch()}
            hasData={Boolean(vendorQuery.data)}
          >
            <DataTable emptyTitle={canReadVendors ? undefined : "没有查看供应商的权限"}
              viewport={{
                mode: "fill",
                mobileContent: true,
                pending: vendorQuery.isPlaceholderData,
                queryKey: JSON.stringify([vendorPagination, debouncedVendorSearch]),
              }}
              layoutControls={{ density: true, fullscreen: true }}
              columns={vendorColumns}
              data={canReadVendors ? vendors : []}
              loading={vendorQuery.isLoading}
              getRowId={(r) => r.id}
              externalSearch={{ value: vendorSearch, onChange: (value) => { setVendorSearch(value); setVendorPagination((current) => ({ ...current, pageIndex: 0 })) } }}
              serverFiltering
              serverPagination={{
                pageIndex: vendorPagination.pageIndex,
                pageSize: vendorPagination.pageSize,
                total: vendorTotal,
                onChange: setVendorPagination,
              }}
              defaultPageSize={20}
            />
          </DataTableCard>
        </TabsContent>
      </Tabs>

      {/* Form Dialogs */}
      {mfrForm && (
        <ManufacturerFormDialog
          open={Boolean(mfrForm)}
          manufacturer={mfrForm === "new" ? null : mfrForm}
          onOpenChange={(op) => !op && setMfrForm(null)}
        />
      )}

      {vendorForm && (
        <VendorFormDialog
          open={Boolean(vendorForm)}
          vendor={vendorForm === "new" ? null : vendorForm}
          onOpenChange={(op) => !op && setVendorForm(null)}
        />
      )}

      {/* Vendor Detail Sheet */}
      {vendorDetail && (
        <VendorDetailSheet
          open={Boolean(vendorDetail)}
          vendor={vendorDetail}
          onOpenChange={(op) => !op && setVendorDetail(null)}
        />
      )}

      {/* Reusable History & References */}
      {historyTarget && (
        <ManagedHistorySheet
          open={Boolean(historyTarget)}
          resourceTitle={historyTarget.title}
          recordName={historyTarget.name}
          recordId={historyTarget.id}
          fetchHistory={historyTarget.fetch}
          onOpenChange={(op) => !op && setHistoryTarget(null)}
        />
      )}

      {refTarget && (
        <ManagedReferencesDialog
          open={Boolean(refTarget)}
          resourceTitle={refTarget.title}
          recordName={refTarget.name}
          recordId={refTarget.id}
          fetchReferences={refTarget.fetch}
          onOpenChange={(op) => !op && setRefTarget(null)}
        />
      )}
      {certificationsOpen && <CertificationsSheet onClose={() => setCertificationsOpen(false)} />}
    </div>
  )
}
