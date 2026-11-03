import type { RowData } from "@tanstack/react-table"
import type { ReactNode } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import { notify } from "@/lib/notify"
import { cn } from "@/lib/utils"
import { DataTableColumnHeader } from "./data-table-column-header"
import { DataTableTextCell } from "./data-table-text"
import { DataTableRowActions, type RowActionItem } from "./data-table-row-actions"
import { copyTableText } from "./data-table-clipboard"
import type { ColumnDef } from "./types"
export type ColumnMeta<TData extends RowData, TValue = unknown> = NonNullable<
  ColumnDef<TData, TValue>["meta"]
>
export interface BaseColumnHelperOptions<TData extends RowData> {
  id?: string
  title: string
  size?: number
  minSize?: number
  maxSize?: number
  enableSorting?: boolean
  enableHiding?: boolean
  enableResizing?: boolean
  headerClassName?: string
  cellClassName?: string | ((row: TData, value: unknown) => string | undefined)
  meta?: Omit<ColumnMeta<TData>, "headerClassName" | "cellClassName">
}
type Accessor<TData, TValue> = {
  accessorKey?: keyof TData & string
  accessorFn?: (row: TData) => TValue | null | undefined
}
function base<TData extends RowData>(
  o: BaseColumnHelperOptions<TData> & Accessor<TData, unknown>,
  text: (row: TData) => string,
): ColumnDef<TData> {
  if (!o.id && !o.accessorKey) throw new Error("accessorFn 列必须提供稳定 id")
  const sizing = Object.fromEntries(
    Object.entries({
      size: o.size,
      minSize: o.minSize,
      maxSize: o.maxSize,
      enableSorting: o.enableSorting,
      enableHiding: o.enableHiding,
      enableResizing: o.enableResizing,
    }).filter(([, v]) => v !== undefined),
  )
  return {
    id: (o.id ?? o.accessorKey)!,
    accessorFn: o.accessorFn ?? ((row) => row[o.accessorKey!]),
    ...sizing,
    header: ({ column }) => <DataTableColumnHeader column={column} title={o.title} />,
    meta: {
      autoSizeText: text,
      ...o.meta,
      export: { enabled: true, label: o.title, ...o.meta?.export },
      headerClassName: o.headerClassName,
      cellClassName: o.cellClassName,
    },
  }
}
const valueOf = <TData,>(o: Accessor<TData, unknown>, row: TData): unknown =>
  o.accessorFn ? o.accessorFn(row) : row[o.accessorKey!]
function parseDateValue(v: unknown): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v !== "string" || !v.trim()) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (match) {
    const year = Number(match[1]),
      month = Number(match[2]),
      day = Number(match[3])
    const local = new Date(year, month - 1, day)
    return local.getFullYear() === year &&
      local.getMonth() === month - 1 &&
      local.getDate() === day
      ? local
      : null
  }
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}
export interface TextColumnOptions<TData extends RowData>
  extends BaseColumnHelperOptions<TData>, Accessor<TData, string> {
  maxLines?: 1 | 2 | 3
  monospace?: boolean
  copyable?: boolean
  emptyText?: string
  renderSecondary?: (row: TData) => ReactNode
}
export function createTextColumn<TData extends RowData>(
  o: TextColumnOptions<TData>,
): ColumnDef<TData> {
  const display = (row: TData) => {
    const value = valueOf(o, row)
    return value == null || value === "" ? (o.emptyText ?? "—") : String(value)
  }
  return {
    ...base(o, display),
    cell: ({ row }) => {
      const raw = valueOf(o, row.original)
      const hasValue = raw != null && raw !== ""
      return (
        <div className={cn("min-w-0", o.monospace && "font-mono")}>
          <div className="flex min-w-0 items-center gap-1">
            <DataTableTextCell
              value={display(row.original)}
              config={{
                mode: (o.maxLines ?? 1) === 1 ? "truncate" : "clamp",
                lines: o.maxLines ?? 1,
              }}
            />
            {o.copyable && hasValue && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`复制${o.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  void copyTableText(String(raw)).then(
                    () => notify.success("已复制"),
                    () => notify.error("复制失败"),
                  )
                }}
              >
                <Copy />
              </Button>
            )}
          </div>
          {o.renderSecondary && (
            <div className="text-xs text-muted-foreground">{o.renderSecondary(row.original)}</div>
          )}
        </div>
      )
    },
  }
}
export interface NumberColumnOptions<TData extends RowData>
  extends BaseColumnHelperOptions<TData>, Accessor<TData, number> {
  format?: (value: number, row: TData) => ReactNode
  unit?: string
  align?: "left" | "right" | "center"
  emptyText?: string
}
export function createNumberColumn<TData extends RowData>(
  o: NumberColumnOptions<TData>,
): ColumnDef<TData> {
  const display = (row: TData) => {
    const v = valueOf(o, row)
    return typeof v === "number" && Number.isFinite(v)
      ? `${v.toLocaleString("zh-CN")}${o.unit ?? ""}`
      : (o.emptyText ?? "—")
  }
  const align = { left: "text-left", right: "text-right", center: "text-center" }[
    o.align ?? "right"
  ]
  const column = base(o, display)
  return {
    ...column,
    id: column.id!,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={o.title}
        className={
          o.align === "left"
            ? "justify-start"
            : o.align === "center"
              ? "justify-center"
              : "justify-end"
        }
      />
    ),
    meta: {
      ...column.meta,
      export: {
        enabled: true,
        label: o.title,
        ...(o.unit
          ? {
              value: (row: TData) => {
                const v = valueOf(o, row)
                return typeof v === "number" && Number.isFinite(v) ? display(row) : ""
              },
            }
          : {}),
        ...o.meta?.export,
      },
      headerClassName: cn(align, o.headerClassName),
      cellClassName: (row, value) =>
        cn(
          align,
          "tabular-nums",
          typeof o.cellClassName === "function" ? o.cellClassName(row, value) : o.cellClassName,
        ),
    },
    cell: ({ row }) => {
      const v = valueOf(o, row.original)
      return typeof v === "number" && Number.isFinite(v) && o.format
        ? o.format(v, row.original)
        : display(row.original)
    },
  }
}
export interface DateColumnOptions<TData extends RowData>
  extends BaseColumnHelperOptions<TData>, Accessor<TData, string | Date> {
  mode?: "datetime" | "date" | "relative"
  format?: (value: string | Date, row: TData) => ReactNode
  emptyText?: string
}
export function createDateColumn<TData extends RowData>(
  o: DateColumnOptions<TData>,
): ColumnDef<TData> {
  const display = (row: TData) => {
    const d = parseDateValue(valueOf(o, row))
    if (!d) return o.emptyText ?? "—"
    return o.mode === "relative"
      ? formatDistanceToNow(d, { addSuffix: true, locale: zhCN })
      : o.mode === "date"
        ? d.toLocaleDateString("zh-CN")
        : d.toLocaleString("zh-CN")
  }
  const column = base(o, display)
  return {
    ...column,
    meta: {
      ...column.meta,
      export: {
        enabled: true,
        label: o.title,
        value: (row: TData) => (parseDateValue(valueOf(o, row)) ? display(row) : ""),
        ...o.meta?.export,
      },
      cellClassName: (row, value) =>
        cn(
          "tabular-nums text-muted-foreground",
          typeof o.cellClassName === "function" ? o.cellClassName(row, value) : o.cellClassName,
        ),
    },
    cell: ({ row }) => {
      const v = valueOf(o, row.original)
      return v != null && o.format && parseDateValue(v)
        ? o.format(v as string | Date, row.original)
        : display(row.original)
    },
  }
}
export interface BadgeOption {
  label: string
  variant?: "default" | "secondary" | "destructive" | "outline"
  className?: string
  icon?: ReactNode
}
export interface BadgeColumnOptions<TData extends RowData, TValue extends string | number = string>
  extends BaseColumnHelperOptions<TData>, Accessor<TData, TValue> {
  options: Record<string, BadgeOption>
  emptyText?: string
}
export function createBadgeColumn<TData extends RowData, TValue extends string | number = string>(
  o: BadgeColumnOptions<TData, TValue>,
): ColumnDef<TData> {
  const option = (row: TData) => {
    const v = valueOf(o, row)
    return v == null || !Object.hasOwn(o.options, String(v)) ? undefined : o.options[String(v)]
  }
  const display = (row: TData) => option(row)?.label ?? o.emptyText ?? "—"
  const column = base(o, display)
  return {
    ...column,
    meta: {
      ...column.meta,
      export: {
        enabled: true,
        label: o.title,
        value: (row: TData) => {
          const item = option(row)
          if (item) return item.label
          const raw = valueOf(o, row)
          return raw == null ? "" : String(raw)
        },
        ...o.meta?.export,
      },
    },
    cell: ({ row }) => {
      const item = option(row.original)
      return item ? (
        <Badge variant={item.variant ?? "outline"} className={item.className}>
          {item.icon}
          {item.label}
        </Badge>
      ) : (
        display(row.original)
      )
    },
  }
}
export interface ActionsColumnOptions<TData extends RowData> {
  id?: string
  title?: string
  srOnlyHeader?: boolean
  size?: number
  disabled?: boolean | ((row: TData) => boolean)
  triggerAriaLabel?: string | ((row: TData) => string)
  actions?: (row: TData) => RowActionItem<TData>[]
  cell?: (row: TData) => ReactNode
}
export function createActionsColumn<TData extends RowData>(
  o: ActionsColumnOptions<TData>,
): ColumnDef<TData> {
  const size = o.size ?? 54
  const label = o.title ?? "操作"
  return {
    id: o.id ?? "actions",
    header: o.srOnlyHeader ? () => <span className="sr-only">{label}</span> : label,
    size,
    minSize: size,
    maxSize: size,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    meta: { export: { enabled: false } },
    cell: ({ row }) =>
      o.cell ? (
        o.cell(row.original)
      ) : (
        <DataTableRowActions
          row={row.original}
          disabled={typeof o.disabled === "function" ? o.disabled(row.original) : o.disabled}
          triggerAriaLabel={
            typeof o.triggerAriaLabel === "function"
              ? o.triggerAriaLabel(row.original)
              : o.triggerAriaLabel
          }
          actions={o.actions?.(row.original) ?? []}
        />
      ),
  }
}
