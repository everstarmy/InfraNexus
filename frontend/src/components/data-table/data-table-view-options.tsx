import { useState, type ReactNode } from "react"
import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
import { ArrowUp, ArrowDown, ChevronsLeftRight, SlidersHorizontal, PanelLeft, PanelRight, Columns3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

interface DataTableViewOptionsProps<TData extends RowData> {
  hideColumns?: boolean
  extraControls?: ReactNode
  table: Table<TData>
  columnLabels?: Record<string, string>
  enableColumnPinning?: boolean
  enhanced?: boolean
  onAutoSize?: (id: string) => void
  onResetLayout?: () => void
}

export function DataTableViewOptions<TData extends RowData>({ hideColumns = false, extraControls, table, enableColumnPinning = Boolean(table.options.enableColumnPinning), columnLabels = {}, onResetLayout, enhanced = false, onAutoSize }: DataTableViewOptionsProps<TData>) {
  const [search, setSearch] = useState("")
  const columns = table.getAllLeafColumns().filter(column => column.accessorFn !== undefined)
  const visibleCount = columns.filter(column => column.getIsVisible()).length
  const move = (id: string, delta: number) => {
    const current = table.getAllLeafColumns().map(column => column.id)
    const index = current.indexOf(id)
    const neighbor = table.getColumn(current[index + delta])
    const column = table.getColumn(id)
    if (!neighbor || !column || column.parent?.id !== neighbor.parent?.id || neighbor.columnDef.meta?.layout?.move === false || !neighbor.accessorFn) return
    ;[current[index], current[index + delta]] = [current[index + delta], current[index]]
    table.setColumnOrder(current)
  }
  return (
    <Popover>
      <PopoverTrigger aria-label="表格设置" title="表格设置" render={<Button variant="outline" size="icon" />}>
        <SlidersHorizontal className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[min(calc(100vw-2rem),var(--available-width))] gap-0 overflow-hidden p-0">
        {hideColumns && <PopoverTitle className="sr-only">表格设置</PopoverTitle>}
        {extraControls && <div className="flex flex-wrap items-center gap-2 border-b p-3">{extraControls}</div>}
        {!hideColumns && <>
        <div className="flex flex-col gap-2 border-b p-3">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>表格设置</PopoverTitle>
            <span className="text-xs text-muted-foreground">显示 {visibleCount} / {columns.length} 列</span>
          </div>
          <Input aria-label="搜索列" placeholder="搜索列名称…" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="data-table-scrollbar max-h-[min(50svh,24rem)] overflow-y-auto p-2">
          {columns.filter(column => (columnLabels[column.id] ?? column.id).toLowerCase().includes(search.trim().toLowerCase())).map(column => {
            const label = columnLabels[column.id] ?? column.id
            return (
              <div key={column.id} className="flex flex-wrap min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted/50">
                <Checkbox aria-label={`显示${label}`} checked={column.getIsVisible()} disabled={!column.getCanHide() || column.columnDef.meta?.layout?.hide === false || (column.getIsVisible() && visibleCount <= 1)} onCheckedChange={checked => column.toggleVisibility(Boolean(checked))} />
                <span className="min-w-0 flex-1 truncate text-xs" title={label}>{label}</span>
                {enhanced && <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`${label}前移`} disabled={column.columnDef.meta?.layout?.move === false || columns.indexOf(column) === 0} onClick={() => move(column.id, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${label}后移`} disabled={column.columnDef.meta?.layout?.move === false || columns.indexOf(column) === columns.length - 1} onClick={() => move(column.id, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`适配${label}列宽`} onClick={() => onAutoSize?.(column.id)}><ChevronsLeftRight /></Button>
                </div>}
                {enableColumnPinning && column.getCanPin() && column.columnDef.meta?.layout?.pin !== false && (
                  <ToggleGroup
                    aria-label={`${label}固定位置`}
                    variant="outline" size="sm" spacing={0}
                    value={[column.getIsPinned() || "none"]}
                    onValueChange={values => {
                      const side = values[0]
                      if (!side) return
                      const dataIds = new Set(columns.map(item => item.id))
                      table.setColumnPinning(current => {
                        const start = current.start.filter(id => id !== column.id && (enhanced || side !== "start" || !dataIds.has(id)))
                        const end = current.end.filter(id => id !== column.id && (enhanced || side !== "end" || !dataIds.has(id)))
                        if (side === "start") start.push(column.id)
                        if (side === "end") end.unshift(column.id)
                        return { start, end }
                      })
                    }}
                  >
                    <ToggleGroupItem value="start" aria-label={`${label}固定左侧`} title={enhanced ? "固定左侧" : "固定左侧（替换原固定列）"}><PanelLeft /></ToggleGroupItem>
                    <ToggleGroupItem value="none" aria-label={`${label}不固定`} title="不固定"><Columns3 /></ToggleGroupItem>
                    <ToggleGroupItem value="end" aria-label={`${label}固定右侧`} title={enhanced ? "固定右侧" : "固定右侧（替换原固定列）"}><PanelRight /></ToggleGroupItem>
                  </ToggleGroup>
                )}
              </div>
            )
          })}
          {!columns.some(column => (columnLabels[column.id] ?? column.id).toLowerCase().includes(search.trim().toLowerCase())) && <p className="p-4 text-center text-xs text-muted-foreground">没有匹配的列</p>}
        </div>
        <div className="flex items-center justify-between border-t p-2">
          <span className="text-xs text-muted-foreground">{enhanced ? "适配仅测量已加载前 100 行" : "调整立即生效"}</span>
          <Button variant="ghost" size="sm" onClick={() => { onResetLayout?.(); setSearch("") }}>恢复默认</Button>
        </div>
        </>}
      </PopoverContent>
    </Popover>
  )
}
