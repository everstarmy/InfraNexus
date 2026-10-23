import { useState } from "react"
import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
import { SlidersHorizontal, PanelLeft, PanelRight, Columns3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

interface DataTableViewOptionsProps<TData extends RowData> {
  table: Table<TData>
  columnLabels?: Record<string, string>
  onResetLayout?: () => void
}

export function DataTableViewOptions<TData extends RowData>({ table, columnLabels = {}, onResetLayout }: DataTableViewOptionsProps<TData>) {
  const [search, setSearch] = useState("")
  const columns = table.getAllLeafColumns().filter(column => column.accessorFn !== undefined)
  const visibleCount = columns.filter(column => column.getIsVisible()).length
  return (
    <Popover>
      <PopoverTrigger aria-label="自定义显示列和固定列" className="ml-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden sm:inline">列设置</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-2 border-b p-3">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>列设置</PopoverTitle>
            <span className="text-xs text-muted-foreground">显示 {visibleCount} / {columns.length} 列</span>
          </div>
          <Input aria-label="搜索列" placeholder="搜索列名称…" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="data-table-scrollbar max-h-[min(50svh,24rem)] overflow-y-auto p-2">
          {columns.filter(column => (columnLabels[column.id] ?? column.id).toLowerCase().includes(search.trim().toLowerCase())).map(column => {
            const label = columnLabels[column.id] ?? column.id
            return (
              <div key={column.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted/50">
                <Checkbox aria-label={`显示${label}`} checked={column.getIsVisible()} disabled={!column.getCanHide() || (column.getIsVisible() && visibleCount <= 1)} onCheckedChange={checked => column.toggleVisibility(Boolean(checked))} />
                <span className="min-w-0 flex-1 truncate text-xs" title={label}>{label}</span>
                {table.options.enableColumnPinning && column.getCanPin() && (
                  <ToggleGroup
                    aria-label={`${label}固定位置`}
                    variant="outline" size="sm" spacing={0}
                    value={[column.getIsPinned() || "none"]}
                    onValueChange={values => {
                      const side = values[0]
                      if (!side) return
                      const dataIds = new Set(columns.map(item => item.id))
                      table.setColumnPinning(current => {
                        const start = current.start.filter(id => id !== column.id && (side !== "start" || !dataIds.has(id)))
                        const end = current.end.filter(id => id !== column.id && (side !== "end" || !dataIds.has(id)))
                        if (side === "start") start.push(column.id)
                        if (side === "end") end.unshift(column.id)
                        return { start, end }
                      })
                    }}
                  >
                    <ToggleGroupItem value="start" aria-label={`${label}固定左侧`} title="固定左侧（替换原固定列）"><PanelLeft /></ToggleGroupItem>
                    <ToggleGroupItem value="none" aria-label={`${label}不固定`} title="不固定"><Columns3 /></ToggleGroupItem>
                    <ToggleGroupItem value="end" aria-label={`${label}固定右侧`} title="固定右侧（替换原固定列）"><PanelRight /></ToggleGroupItem>
                  </ToggleGroup>
                )}
              </div>
            )
          })}
          {!columns.some(column => (columnLabels[column.id] ?? column.id).toLowerCase().includes(search.trim().toLowerCase())) && <p className="p-4 text-center text-xs text-muted-foreground">没有匹配的列</p>}
        </div>
        <div className="flex items-center justify-between border-t p-2">
          <span className="text-xs text-muted-foreground">调整立即生效</span>
          <Button variant="ghost" size="sm" onClick={() => { onResetLayout?.(); setSearch("") }}>恢复默认</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
