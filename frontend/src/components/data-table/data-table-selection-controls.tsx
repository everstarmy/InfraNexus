import * as React from "react"
import { Popover } from "@base-ui/react/popover"
import { ChevronUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DataTableSelectionArea } from "./data-table-selection-area"

export function DataTableSelectionControls<TData>({ total, selectionArea, selectedRows, batchActions, onClear }: {
  total: number
  selectionArea?: DataTableSelectionArea
  selectedRows: TData[]
  batchActions?: (rows: TData[], clear: () => void) => React.ReactNode
  onClear: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const count = selectionArea?.count ?? selectedRows.length
  const clear = selectionArea?.onClear ?? onClear
  const currentCount = selectionArea?.currentPageCount ?? selectedRows.length
  const summary = `已选 ${selectionArea?.estimated ? "约 " : ""}${count} 条`
  if (count === 0) return <span>共 {total} 条记录</span>
  return (
    <div className="flex min-w-0 items-center gap-2" data-slot="data-table-selection-controls">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger render={<Button size="sm" variant="outline" className="h-8 min-w-0" />} aria-label="批量操作">
          <span className="truncate">{`${summary} · 批量操作`}</span>
          <ChevronUp />
        </Popover.Trigger>
        {/* Keep business actions mounted so closing the popup or clearing selection
            does not discard pending requests. */}
        <Popover.Portal keepMounted>
          <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
            <Popover.Popup hidden={!open} className="flex max-h-[min(70svh,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg outline-none">
              <Popover.Title className="font-medium">批量操作</Popover.Title>
              <p role="status">{summary} · 当前页 {currentCount} 条</p>
              {selectionArea?.selectAll && <Button size="sm" variant="outline" disabled={selectionArea.disabled} onClick={selectionArea.selectAll.onSelect}>选择全部匹配 {selectionArea.selectAll.count} 条</Button>}
              <div role="region" aria-label="批量操作" className="flex flex-wrap gap-2" onClick={event => {
                const button = (event.target as HTMLElement).closest("button")
                if (button && event.currentTarget.contains(button) && !button.disabled && !button.hasAttribute("aria-haspopup")) setOpen(false)
              }}>
                {selectionArea ? selectionArea.actions : batchActions?.(selectedRows, clear)}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Button size="icon-sm" variant="ghost" aria-label="取消选择" title="取消选择" disabled={selectionArea?.disabled} onClick={() => { clear(); setOpen(false) }}><X /></Button>
    </div>
  )
}
