import type { DataTableDensity } from "./data-table-layout"
import * as React from "react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { TableBody } from "@/components/ui/table"

export interface DataTableVirtualization {
  /** Estimated height only; mounted rows are measured, including wrapped text. */
  estimateRowHeight?: number
  /** Extra rows on each side, bounded to 1–20. Default 6. */
  overscan?: number
}
export type VirtualRowAttributes = {
  ref?: React.Ref<HTMLTableRowElement>
  "data-index"?: number
  "aria-rowindex"?: number
}
export type RestoreVirtualAnchor = (id: string, offset: number) => boolean

/** Scroll subscriptions live here, so a scroll does not rerender the table toolbar. */
export function DataTableVirtualBody({
  ids,
  scrollRef,
  scrollNode,
  restoreRef,
  columns,
  headerRows,
  options,
  density,
  children,
}: {
  scrollNode: HTMLDivElement | null
  ids: string[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  restoreRef: React.RefObject<RestoreVirtualAnchor | null>
  columns: number
  headerRows: number
  density: DataTableDensity
  options: DataTableVirtualization
  children: (index: number, attributes: VirtualRowAttributes) => React.ReactNode
}) {
  const bodyRef = React.useRef<HTMLTableSectionElement>(null)
  const [focusID, setFocusID] = React.useState<string | null>(null)
  const [headerHeight, setHeaderHeight] = React.useState(headerRows * 40)
  const focusedIndex = React.useMemo(
    () => (focusID === null ? -1 : ids.indexOf(focusID)),
    [ids, focusID],
  )
  const getItemKey = React.useCallback((index: number) => ids[index], [ids])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: ids.length,
    getScrollElement: () => scrollNode,
    getItemKey,
    estimateSize: () =>
      Number.isFinite(options.estimateRowHeight)
        ? Math.max(24, Math.min(500, options.estimateRowHeight!))
        : density === "compact"
          ? 36
          : density === "comfortable"
            ? 60
            : 44,
    overscan: Number.isFinite(options.overscan)
      ? Math.max(1, Math.min(20, Math.floor(options.overscan!)))
      : 6,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
    rangeExtractor: React.useCallback(
      (range) => {
        const indexes = defaultRangeExtractor(range)
        // Keep focus and adjacent tab targets mounted even after wheel scrolling.
        if (focusedIndex >= 0)
          for (
            let i = Math.max(0, focusedIndex - 1);
            i <= Math.min(ids.length - 1, focusedIndex + 1);
            i++
          )
            indexes.push(i)
        return [...new Set(indexes)].sort((a, b) => a - b)
      },
      [focusedIndex, ids.length],
    ),
    useAnimationFrameWithResizeObserver: true,
  })
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    const top = instance.scrollOffset ?? 0
    const height = instance.scrollRect?.height ?? 0
    // When the scrollbar reaches the end, newly measured tall rows must not
    // push the last row out of reach. Otherwise keep the usual leading anchor.
    return top + height >= instance.getTotalSize() + headerHeight - 2 || item.start < top
  }
  React.useLayoutEffect(() => {
    const offset = virtualizer.scrollOffset ?? 0
    const anchor = virtualizer.getVirtualItems().find((item) => item.end > offset + headerHeight)
    const id = anchor ? ids[anchor.index] : undefined
    const delta = anchor ? offset + headerHeight - anchor.start : 0
    virtualizer.measure()
    // Density changes can happen during scrolling, when measureElement defers
    // synchronous reads. Resolve the mounted rows under the new density now.
    virtualizer.getTotalSize()
    bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-index]").forEach((row) => {
      virtualizer.resizeItem(Number(row.dataset.index), row.getBoundingClientRect().height)
    })
    if (id) {
      // measure() invalidates sizes; getOffsetForIndex reads the current cache.
      // Rebuild it before resolving the same ID under the new density.
      virtualizer.getTotalSize()
      const index = ids.indexOf(id)
      const target = virtualizer.getOffsetForIndex(index, "start")
      if (target) virtualizer.scrollToIndex(index, { align: "start" })
      // Commit the newly targeted range, then measure it before releasing the
      // command. Keep the pixel delta without retaining an index scroll target
      // that could override the user's next scroll. Cleanup cancels both.
      const frame = requestAnimationFrame(() => {
        bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-index]").forEach((row) => {
          virtualizer.resizeItem(Number(row.dataset.index), row.getBoundingClientRect().height)
        })
        virtualizer.getTotalSize()
        const measured = virtualizer.getOffsetForIndex(index, "start")
        virtualizer.cancelScroll()
        if (measured && scrollRef.current) scrollRef.current.scrollTop = measured[0] + delta
      })
      return () => {
        cancelAnimationFrame(frame)
        virtualizer.cancelScroll()
      }
    }
    // Query/row changes retain the existing ID-based restoration path.
  }, [density, options.estimateRowHeight])
  const cachedIDs = React.useRef<Set<string> | null>(null)
  if (cachedIDs.current === null) cachedIDs.current = new Set(ids)
  React.useLayoutEffect(() => {
    const current = new Set(ids)
    for (const id of ids) cachedIDs.current!.add(id)
    if (cachedIDs.current!.size > Math.max(100, ids.length * 2)) {
      // Bound historical measurement keys while preserving anchors on small inserts/deletes.
      cachedIDs.current = current
      virtualizer.measure()
      bodyRef.current
        ?.querySelectorAll<HTMLTableRowElement>("tr[data-index]")
        .forEach(virtualizer.measureElement)
    }
    if (focusID && !current.has(focusID)) scrollRef.current?.focus()
  }, [ids, focusID, scrollRef, virtualizer])
  React.useLayoutEffect(() => {
    const head = bodyRef.current?.closest("table")?.querySelector("thead")
    if (!head) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setHeaderHeight(head.getBoundingClientRect().height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(head)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
  React.useLayoutEffect(() => {
    restoreRef.current = (id, offset) => {
      const index = ids.indexOf(id)
      if (index < 0) return false
      const target = virtualizer.getOffsetForIndex(index, "start")
      if (!target || !scrollRef.current) return false
      // Restore once. A persistent scroll-to-index command would retarget after
      // measurement and override a user's subsequent jump to another position.
      scrollRef.current.scrollTop = target[0] - offset
      return true
    }
    return () => {
      restoreRef.current = null
    }
  }, [ids, restoreRef, scrollRef, virtualizer])
  const items = virtualizer.getVirtualItems()
  const spacer = (height: number, key: string) =>
    height > 0 ? (
      <tr key={key} aria-hidden="true">
        <td colSpan={columns} style={{ height, padding: 0, border: 0 }} />
      </tr>
    ) : null
  let end = 0
  return (
    <TableBody
      ref={bodyRef}
      onFocusCapture={(event) =>
        setFocusID(
          (event.target as HTMLElement).closest<HTMLElement>("[data-row-id]")?.dataset.rowId ??
            null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusID(null)
      }}
    >
      {items.map((item) => {
        const gap = item.start - headerHeight - end
        end = item.end - headerHeight
        return (
          <React.Fragment key={item.key}>
            {spacer(gap, `before-${item.key}`)}
            {children(item.index, {
              ref: virtualizer.measureElement,
              "data-index": item.index,
              "aria-rowindex": headerRows + item.index + 1,
            })}
          </React.Fragment>
        )
      })}
      {spacer(virtualizer.getTotalSize() - end, "after")}
    </TableBody>
  )
}
