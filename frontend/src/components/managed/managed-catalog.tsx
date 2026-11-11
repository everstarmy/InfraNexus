import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { History, Link2, Pencil, Plus, Trash2 } from "lucide-react"
import {
  DataTable,
  DataTableCard,
  DataTableTitle,
  createActionsColumn,
  type ColumnDef,
} from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { useAuth } from "@/stores/auth-context"
import type { ManagedBase, createManagedClient } from "@/services/managed"
import { ManagedEditor, type EditorField } from "./managed-editor"
import { ManagedHistorySheet } from "./managed-history-sheet"
import { ManagedReferencesDialog } from "./managed-references-dialog"
import { ManagedTransferActions } from "./managed-transfer-actions"

export function ManagedCatalog<T extends ManagedBase>({
  label,
  permission,
  resourceKey,
  service,
  fields,
  columns: extraColumns = [],
  retain,
}: {
  label: string
  permission: string
  resourceKey: string
  service: ReturnType<typeof createManagedClient<T>>
  fields: readonly EditorField<T>[]
  columns?: ColumnDef<T>[]
  retain?: boolean
}) {
  const { can } = useAuth()
  const canRead = can(`${permission}:read`)
  const client = useQueryClient()
  const confirm = useConfirm()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<T | "new" | null>(null)
  const [history, setHistory] = useState<T | null>(null)
  const [reference, setReference] = useState<T | null>(null)
  const term = useDebouncedValue(search.trim(), 250)
  const filters = { search: term }
  const query = useQuery({
    queryKey: [resourceKey, "catalog", pagination, term],
    queryFn: ({ signal }) =>
      service.list(
        { ...filters, page: pagination.pageIndex + 1, page_size: pagination.pageSize },
        signal,
      ),
    enabled: canRead,
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: [resourceKey] })
  }
  const mutation = useMutation({
    mutationFn: async ({ record, status }: { record: T; status?: number }) => {
      if (status === undefined) await service.remove(record.id, record.version)
      else await service.setStatus(record.id, record.version, status)
    },
    onSuccess: () => {
      notify.success("操作成功")
      refresh()
    },
    onError: (error) => notify.error("操作失败", getErrorMessage(error)),
  })
  const remove = async (record: T) => {
    if (
      await confirm({
        title: `删除「${record.name}」？`,
        description: "存在引用的记录无法删除。",
        tone: "destructive",
        confirmText: "删除",
      })
    ) {
      mutation.mutate({ record })
    }
  }
  const columns: ColumnDef<T>[] = [
    { id: "code", accessorKey: "code", header: "编码" },
    { id: "name", accessorKey: "name", header: "名称" },
    ...extraColumns,
    {
      id: "status",
      accessorKey: "status",
      header: "启用",
      cell: ({ row }) => (
        <Switch
          checked={row.original.status === 1}
          disabled={!can(`${permission}:status`) || mutation.isPending}
          aria-label={`启停${row.original.name}`}
          onCheckedChange={(checked) =>
            mutation.mutate({ record: row.original, status: checked ? 1 : 2 })
          }
        />
      ),
    },
    createActionsColumn<T>({
      actions: (record) => [
        {
          key: "edit",
          label: "编辑",
          icon: <Pencil />,
          hidden: !can(`${permission}:update`),
          onSelect: () => setEditing(record),
        },
        {
          key: "references",
          label: "查看引用",
          icon: <Link2 />,
          onSelect: () => setReference(record),
        },
        {
          key: "history",
          label: "变更历史",
          icon: <History />,
          hidden: !can(`${permission}:history`),
          onSelect: () => setHistory(record),
        },
        {
          key: "delete",
          label: "删除",
          icon: <Trash2 />,
          destructive: true,
          hidden: retain || !can(`${permission}:delete`),
          disabled: mutation.isPending,
          onSelect: () => void remove(record),
        },
      ],
    }),
  ]
  return (
    <>
      <DataTableCard
        label={label}
        title={<DataTableTitle title={label} count={query.data?.data.total ?? 0} />}
        error={query.error}
        hasData={Boolean(query.data)}
        onRetry={() => void query.refetch()}
        actions={
          <>
            <ManagedTransferActions
              permission={permission}
              label={label}
              service={service}
              filters={filters}
              onImported={refresh}
            />
            {can(`${permission}:create`) && (
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus />
                新建{label}
              </Button>
            )}
          </>
        }
      >
        <DataTable
          columns={columns}
          data={canRead ? (query.data?.data.items ?? []) : []}
          loading={query.isLoading}
          emptyTitle={canRead ? undefined : `没有查看${label}的权限`}
          getRowId={(row) => row.id}
          serverFiltering
          externalSearch={{
            value: search,
            onChange: (value) => {
              setSearch(value)
              setPagination((previous) => ({ ...previous, pageIndex: 0 }))
            },
          }}
          serverPagination={{
            ...pagination,
            total: query.data?.data.total ?? 0,
            onChange: setPagination,
          }}
        />
      </DataTableCard>
      {editing && (
        <ManagedEditor
          title={label}
          record={editing === "new" ? null : editing}
          fields={fields}
          save={async (changes) => {
            const result = await (editing === "new"
              ? service.create(changes)
              : service.update(editing, changes))
            refresh()
            return result
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {history && (
        <ManagedHistorySheet
          open
          resourceTitle={label}
          recordName={history.name}
          recordId={history.id}
          fetchHistory={service.history}
          onOpenChange={(open) => !open && setHistory(null)}
        />
      )}
      {reference && (
        <ManagedReferencesDialog
          open
          resourceTitle={label}
          recordName={reference.name}
          recordId={reference.id}
          fetchReferences={service.references}
          onOpenChange={(open) => !open && setReference(null)}
        />
      )}
    </>
  )
}
