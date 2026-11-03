import { Download } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from "@/components/ui/popover"
import {
  copyTableText,
  loadedRowsTSV,
  getVisibleExportColumnIds,
} from "@/components/data-table/data-table-clipboard"
import type { Table } from "@/components/data-table/types"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/common/confirm-dialog"
import { notify } from "@/lib/notify"
import type { TableSelection } from "@/components/data-table/data-table-selection"
import { selectedOnPage } from "@/components/data-table/data-table-selection"
import {
  userSelection,
  userTableActions,
  type UserSelectionQuery,
} from "@/services/user-table-actions"
import type { UserDTO } from "@/services/types"

const ALLOWED_EXPORT_FIELDS = new Set([
  "id",
  "username",
  "nickname",
  "email",
  "status",
  "auth_type",
  "domain",
  "department",
  "roles",
  "created_at",
  "last_login_at",
  "edit_revision",
])

export function UserTableActions({
  managedSelection = false,
  extraActions,
  selection,
  onChange,
  query,
  rows,
  total,
  pending,
  canStatus,
  onRefresh,
  onBusyChange,
}: {
  managedSelection?: boolean
  extraActions?: ReactNode
  selection: TableSelection
  onChange: (value: TableSelection) => void
  query: UserSelectionQuery
  rows: UserDTO[]
  total: number
  pending: boolean
  canStatus: boolean
  onRefresh: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const confirm = useConfirm()
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const ids = rows.map((row) => row.id)
  const count =
    selection.mode === "allMatching"
      ? Math.max(0, total - selection.excludedIds.length)
      : selection.ids.length
  const currentCount = Object.keys(selectedOnPage(selection, ids)).length

  const run = async (work: () => Promise<void>) => {
    if (lock.current || pending) return
    lock.current = true
    setBusy(true)
    onBusyChange?.(true)
    try {
      await work()
    } catch {
      notify.error("操作失败，请刷新后重试")
    } finally {
      lock.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  const execute = async (status: number) =>
    run(async () => {
      const descriptor = userSelection(selection, query)
      const accepted = await confirm({
        title: `批量${status === 1 ? "启用" : "停用"}用户`,
        description: `确认将所选 ${count} 个用户设为${status === 1 ? "启用" : "停用"}？`,
        confirmText: status === 1 ? "确认启用" : "确认停用",
        tone: status === 1 ? "default" : "destructive",
      })
      if (!accepted || !alive.current) return
      const items = (await userTableActions.preview(descriptor, status)).data.items
      if (!items.length) {
        notify.info("没有匹配的用户，请刷新列表后重试")
        return
      }
      if (!alive.current) return
      const response = (await userTableActions.execute(descriptor, status, items)).data
      if (!alive.current) {
        onRefresh()
        return
      }
      const summary = `成功 ${response.success} 条，失败 ${response.failed} 条，跳过 ${response.skipped} 条`
      if (response.failed > 0) {
        notify.error(
          "批量操作存在失败项",
          `${summary}。${[...new Set(response.items.filter((item) => item.outcome === "failed").map((item) => item.reason))].slice(0, 3).join("；")}`,
        )
      } else {
        notify.success("批量操作完成", summary)
      }
      onChange({
        mode: "ids",
        ids: response.items.filter((item) => item.outcome === "failed").map((item) => item.id),
      })
      onRefresh()
    })

  if (count === 0) return null

  return (
    <div
      role={!managedSelection ? "region" : undefined}
      aria-label={!managedSelection ? "批量操作" : undefined}
      className="flex flex-wrap items-center gap-2"
    >
      {extraActions}
      {!managedSelection &&
        selection.mode !== "allMatching" &&
        currentCount === ids.length &&
        total > currentCount && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || pending}
            onClick={() => onChange({ mode: "allMatching", excludedIds: [] })}
          >
            选择全部匹配 {total} 条
          </Button>
        )}
      {!managedSelection && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || pending}
          onClick={() => onChange({ mode: "ids", ids: [] })}
        >
          取消选择
        </Button>
      )}
      {canStatus && (
        <>
          {[1, 2].map((status) => (
            <Button
              key={status}
              size="sm"
              variant="outline"
              disabled={busy || pending || !count || count > 200}
              onClick={() => void execute(status)}
            >
              批量{status === 1 ? "启用" : "停用"}
            </Button>
          ))}
        </>
      )}
    </div>
  )
}

export function UserTableExport({
  table,
  selection,
  query,
  rows,
  total,
  pending,
  canExport,
  columnLabels,
  onBusyChange,
}: {
  table: Table<UserDTO>
  selection: TableSelection
  query: UserSelectionQuery
  rows: UserDTO[]
  total: number
  pending: boolean
  canExport: boolean
  columnLabels?: Record<string, string>
  onBusyChange?: (busy: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  if (!canExport) return null

  const ids = rows.map((row) => row.id)
  const count =
    selection.mode === "allMatching"
      ? Math.max(0, total - selection.excludedIds.length)
      : selection.ids.length

  const getExportFields = (): string[] => {
    const visible = getVisibleExportColumnIds(table)
    const matched = visible.filter((col) => ALLOWED_EXPORT_FIELDS.has(col))
    return matched.length > 0 ? matched : ["username", "nickname", "email", "status"]
  }

  const run = async (work: () => Promise<void>) => {
    if (lock.current || pending) return
    lock.current = true
    setBusy(true)
    onBusyChange?.(true)
    try {
      await work()
      setOpen(false)
    } catch {
      notify.error("操作失败，请刷新后重试；导出请确认权限与 5000 条上限")
    } finally {
      lock.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  const downloadCSV = (targetSelection: Parameters<typeof userSelection>[0]) =>
    run(async () => {
      const exportFields = getExportFields()
      const blob = await userTableActions.export(
        userSelection(targetSelection, query),
        exportFields,
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "users.csv"
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify.success("CSV 已生成，记录数以文件内容为准")
    })

  const copyTSV = (onlySelected: boolean) =>
    run(async () => {
      const selectedIds = new Set(selection.mode === "ids" ? selection.ids : [])
      const targetRows = onlySelected
        ? table.getRowModel().rows.filter((row) => selectedIds.has(row.original.id))
        : table.getRowModel().rows
      try {
        await copyTableText(loadedRowsTSV(table, columnLabels, targetRows))
        notify.success(`已复制 ${targetRows.length} 行表格文本 (TSV)`)
      } catch {
        notify.error("复制失败，请检查浏览器剪贴板权限")
      }
    })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            title="导出数据"
            aria-label="导出数据"
            disabled={busy || pending}
          />
        }
      >
        <Download className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-3">
        <div>
          <PopoverTitle className="text-sm font-medium">导出数据</PopoverTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            自动匹配当前表格可见列
          </p>
        </div>

        {count > 0 ? (
          <div className="space-y-2">
            <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
              已选 <span className="font-semibold text-foreground">{count}</span> 条数据
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              disabled={busy || pending || count > 5000}
              onClick={() => void downloadCSV(selection)}
            >
              下载已选 CSV ({count} 条)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              disabled={busy || pending || !rows.length}
              onClick={() => void copyTSV(true)}
            >
              复制已选 TSV
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              disabled={busy || pending || !rows.length}
              onClick={() => void downloadCSV({ mode: "page", ids })}
            >
              下载当前页 CSV ({rows.length} 条)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              disabled={busy || pending || !total || total > 5000}
              onClick={() => void downloadCSV({ mode: "allMatching", excludedIds: [] })}
            >
              下载全部匹配 CSV (共 {total} 条)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              disabled={busy || pending || !rows.length}
              onClick={() => void copyTSV(false)}
            >
              复制当前页 TSV
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
