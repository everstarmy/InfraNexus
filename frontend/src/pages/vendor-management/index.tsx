import { useCallback, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Building2,
  ExternalLink,
  History,
  Link2,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react"
import {
  DataTable,
  DataTableCard,
  DataTableTitle,
  createActionsColumn,
  type ColumnDef,
} from "@/components/data-table"
import { Button } from "@/components/ui/button"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { useConfirm } from "@/components/common/confirm-dialog"
import { PageHeader } from "@/components/common/page-header"
import { ManagedHistorySheet } from "@/components/managed/managed-history-sheet"
import { ManagedReferencesDialog } from "@/components/managed/managed-references-dialog"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getErrorMessage } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import {
  companiesService,
  type CompanyDTO,
} from "@/services/vendor-management"
import { useAuth } from "@/stores/auth-context"
import { CompanyContactsSheet } from "./components/company-contacts-sheet"
import { CompanyFormDialog } from "./components/company-form-dialog"
import {
  COMPANY_TYPE_FILTER_OPTIONS,
  CompanyTypeBadges,
  toSafeExternalUrl,
  type CompanyTypeFilter,
} from "./components/company-meta"

type StatusFilter = "all" | "1" | "2"

export default function VendorManagementPage() {
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const canRead = can("vendor-management:companies:read")
  const canCreate = can("vendor-management:companies:create")
  const canUpdate = can("vendor-management:companies:update")
  const canToggleStatus = can("vendor-management:companies:status")
  const canDelete = can("vendor-management:companies:delete")
  const canHistory = can("vendor-management:companies:history")

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<CompanyTypeFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const [formTarget, setFormTarget] = useState<CompanyDTO | "new" | null>(null)
  const [contactsOwner, setContactsOwner] = useState<CompanyDTO | null>(null)
  const [historyTarget, setHistoryTarget] = useState<CompanyDTO | null>(null)
  const [referenceTarget, setReferenceTarget] = useState<CompanyDTO | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const queryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: typeFilter === "all" ? undefined : Number(typeFilter),
      status: statusFilter === "all" ? undefined : Number(statusFilter),
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    [debouncedSearch, typeFilter, statusFilter, pagination],
  )

  const query = useQuery({
    queryKey: queryKeys.companies(queryParams),
    queryFn: ({ signal }) => companiesService.list(queryParams, signal),
    enabled: canRead,
  })

  const mutation = useMutation({
    mutationFn: async ({
      record,
      status,
    }: {
      record: CompanyDTO
      status?: number
    }) => {
      if (status === undefined) {
        await companiesService.remove(record.id, record.version)
      } else {
        await companiesService.setStatus(record.id, record.version, status)
      }
    },
    onSuccess: () => {
      notify.success("操作成功")
      void queryClient.invalidateQueries({ queryKey: queryKeys.companiesAll })
    },
    onError: (err) => notify.error("操作失败", getErrorMessage(err)),
  })

  const handleDelete = useCallback(
    async (record: CompanyDTO) => {
      const ok = await confirm({
        title: `删除厂商「${record.name}」？`,
        description: "存在联系人或业务引用的厂商记录无法删除。",
        tone: "destructive",
        confirmText: "删除",
      })
      if (ok) {
        mutation.mutate({ record })
      }
    },
    [confirm, mutation],
  )

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  const handleTypeFilterChange = useCallback((next: CompanyTypeFilter) => {
    setTypeFilter(next)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  const handleStatusFilterChange = useCallback((next: StatusFilter) => {
    setStatusFilter(next)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  const resetFilters = useCallback(() => {
    setSearch("")
    setTypeFilter("all")
    setStatusFilter("all")
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  const items = canRead ? (query.data?.data.items ?? []) : []
  const total = query.data?.data.total ?? 0
  const isFiltered = Boolean(search || typeFilter !== "all" || statusFilter !== "all")

  const columns = useMemo<ColumnDef<CompanyDTO>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "厂商名称",
        size: 260,
        cell: ({ row }) => {
          const item = row.original
          const secondary = [item.short_name, item.english_name].filter(Boolean).join(" · ")
          return (
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{item.name}</div>
              {secondary && (
                <div className="truncate text-xs text-muted-foreground">{secondary}</div>
              )}
            </div>
          )
        },
      },
      {
        id: "type",
        accessorKey: "type",
        header: "厂商类型",
        size: 190,
        cell: ({ row }) => <CompanyTypeBadges type={row.original.type} />,
      },
      {
        id: "credit_code",
        accessorKey: "credit_code",
        header: "统一社会信用代码",
        size: 190,
        cell: ({ row }) =>
          row.original.credit_code ? (
            <span className="font-mono text-xs">{row.original.credit_code}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "website",
        accessorKey: "website",
        header: "官网",
        size: 200,
        cell: ({ row }) => {
          const safeUrl = toSafeExternalUrl(row.original.website)
          if (!safeUrl) {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
            >
              <span className="truncate">{safeUrl.replace(/^https?:\/\//, "")}</span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          )
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "启用",
        size: 84,
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={row.original.status === 1}
              disabled={!canToggleStatus || mutation.isPending}
              aria-label={`启停${row.original.name}`}
              onCheckedChange={(checked) =>
                mutation.mutate({ record: row.original, status: checked ? 1 : 2 })
              }
            />
          </div>
        ),
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: "创建时间",
        size: 160,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(row.original.created_at)}
          </span>
        ),
      },
      createActionsColumn<CompanyDTO>({
        actions: (record) => [
          {
            key: "contacts",
            label: "详情与联系人",
            icon: <Users />,
            onSelect: () => setContactsOwner(record),
          },
          {
            key: "edit",
            label: "编辑",
            icon: <Pencil />,
            hidden: !canUpdate,
            onSelect: () => setFormTarget(record),
          },
          {
            key: "references",
            label: "查看引用",
            icon: <Link2 />,
            onSelect: () => setReferenceTarget(record),
          },
          {
            key: "history",
            label: "变更历史",
            icon: <History />,
            hidden: !canHistory,
            onSelect: () => setHistoryTarget(record),
          },
          {
            key: "delete",
            label: "删除",
            icon: <Trash2 />,
            destructive: true,
            hidden: !canDelete,
            disabled: mutation.isPending,
            onSelect: () => void handleDelete(record),
          },
        ],
      }),
    ],
    [canDelete, canHistory, canToggleStatus, canUpdate, handleDelete, mutation],
  )

  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <PageHeader
        title="制造商与供应商"
        description="统一管理设备硬件制造商与采购/维保供应商档案，支持多重厂商身份与联系人维护"
        icon={Building2}
      />

      <DataTableCard
        className="table-workspace-body"
        label="厂商列表"
        title={
          <DataTableTitle
            title={isFiltered ? "筛选结果" : "全部厂商"}
            count={total}
          />
        }
        actions={
          canCreate ? (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setFormTarget("new")}
            >
              <Plus className="size-3.5" />
              新建厂商
            </Button>
          ) : undefined
        }
        isPlaceholderData={query.isPlaceholderData}
        error={query.error}
        hasData={Boolean(query.data)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      >
        <DataTable
          viewport={{
            mode: "fill",
            mobileContent: true,
            pending: query.isPlaceholderData,
            queryKey: JSON.stringify(queryParams),
            restoreKey: user?.id ? `vendor-companies:${user.id}` : undefined,
          }}
          layoutControls={{ density: true, fullscreen: true }}
          columns={columns}
          data={items}
          loading={query.isLoading}
          getRowId={(r) => r.id}
          serverFiltering
          externalSearch={{ value: search, onChange: handleSearchChange }}
          searchPlaceholder="搜索厂商名称…"
          searchTrailing={
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="按厂商类型过滤"
                className="inline-flex h-8 max-w-full items-center overflow-x-auto rounded-lg border border-border/80 bg-muted/40 p-0.5"
              >
                {COMPANY_TYPE_FILTER_OPTIONS.map((option) => {
                  const active = typeFilter === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleTypeFilterChange(option.value)}
                      className={cn(
                        "h-6.5 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors",
                        active
                          ? "bg-background text-foreground shadow-2xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>

              <NativeSelect
                aria-label="按状态过滤"
                value={statusFilter}
                onChange={(e) => handleStatusFilterChange(e.target.value as StatusFilter)}
                className="h-8 w-28 text-xs"
              >
                <NativeSelectOption value="all">全部状态</NativeSelectOption>
                <NativeSelectOption value="1">仅启用</NativeSelectOption>
                <NativeSelectOption value="2">仅停用</NativeSelectOption>
              </NativeSelect>

              {(typeFilter !== "all" || statusFilter !== "all") && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  重置筛选
                </Button>
              )}
            </div>
          }
          serverPagination={{
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
            total,
            onChange: setPagination,
          }}
          defaultPageSize={20}
          columnLabels={{
            name: "厂商名称",
            type: "厂商类型",
            credit_code: "统一社会信用代码",
            website: "官网",
            status: "启用",
            created_at: "创建时间",
          }}
          initialColumnVisibility={{ created_at: false }}
          onRefresh={() => void query.refetch()}
          isRefreshing={query.isFetching}
          onRowClick={(company) => !query.isPlaceholderData && setContactsOwner(company)}
          stickyActionColumn
          enableColumnResizing
          enableColumnPinning
          initialColumnPinning={{ start: ["name"], end: ["actions"] }}
          tablePreference={
            user?.id ? { userId: user.id, tableId: "vendor-companies", schemaVersion: 1 } : undefined
          }
          emptyTitle={canRead ? (isFiltered ? "没有匹配的厂商" : "还没有厂商档案") : "没有查看厂商档案的权限"}
          emptyDescription={
            canRead
              ? isFiltered
                ? "请尝试调整搜索词或类型/状态筛选条件"
                : "点击右上角「新建厂商」创建制造商或供应商档案"
              : undefined
          }
        />
      </DataTableCard>

      <CompanyFormDialog
        open={formTarget !== null}
        company={formTarget === "new" ? null : formTarget}
        onOpenChange={(open) => !open && setFormTarget(null)}
      />

      {contactsOwner && (
        <CompanyContactsSheet
          key={contactsOwner.id}
          company={contactsOwner}
          onOpenChange={(open) => !open && setContactsOwner(null)}
        />
      )}

      {historyTarget && (
        <ManagedHistorySheet
          open
          resourceTitle="厂商档案"
          recordName={historyTarget.name}
          recordId={historyTarget.id}
          fetchHistory={companiesService.history}
          onOpenChange={(open) => !open && setHistoryTarget(null)}
        />
      )}

      {referenceTarget && (
        <ManagedReferencesDialog
          open
          resourceTitle="厂商档案"
          recordName={referenceTarget.name}
          recordId={referenceTarget.id}
          fetchReferences={companiesService.references}
          onOpenChange={(open) => !open && setReferenceTarget(null)}
        />
      )}
    </div>
  )
}
