import * as React from "react"
import { cn } from "@/lib/utils"
import { viewportHeight, type DataTableViewport } from "./data-table-layout"

export interface TableScrollPosition { query: string; view?: string; scope?: string; top: number; left: number; anchor?: string; offset?: number }
const returnPositions = new Map<string, TableScrollPosition>()

export function DataTableViewportArea({ children, config, query, ready, revision, position, fill, externalScrollRef, onScrollElement, restoreVirtualAnchor, virtualized = false, pinOffsets, updating = false }: {
  updating?: boolean
  pinOffsets?: { start: string; end: string }
  virtualized?: boolean
  onScrollElement?: (node: HTMLDivElement | null) => void
  externalScrollRef?: React.RefObject<HTMLDivElement | null>
  restoreVirtualAnchor?: React.RefObject<import("./data-table-virtual-body").RestoreVirtualAnchor | null>
  children: React.ReactNode
  config?: DataTableViewport
  query: string
  ready: boolean
  revision: unknown
  position: React.RefObject<TableScrollPosition | null>
  fill: boolean
}) {
  const internalScrollRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = externalScrollRef ?? internalScrollRef
  const attachScroll = React.useCallback((node: HTMLDivElement | null) => { scrollRef.current = node; onScrollElement?.(node) }, [scrollRef, onScrollElement])
  const [edges, setEdges] = React.useState({ hasStart: false, hasEnd: false, scrollbar: 0, start: 0, end: 0, scrolling: false })
  const lastScrollLeftRef = React.useRef(0)
  const scrollTimerRef = React.useRef<number | undefined>(undefined)
  const restoringRef = React.useRef(false)
  const readyRef = React.useRef(ready)
  readyRef.current = ready
  const maxHeight = config?.mode === "max-height" ? viewportHeight(config.maxHeight) : undefined
  const bounded = fill || (config?.mode === "max-height" && !!maxHeight)
  const cacheKey = config?.restoreKey
  const view = config?.viewKey
  const effectiveQuery = JSON.stringify([query, config?.queryKey])
  const remember = React.useCallback(() => {
    const el = scrollRef.current
    if (!el || !readyRef.current || restoringRef.current) return
    const head = el.querySelector("thead")?.getBoundingClientRect().height ?? 0
    const origin = el.getBoundingClientRect().top + head
    const rows = el.querySelectorAll<HTMLElement>("tbody tr[data-row-id]")
    // Rows are in vertical order: locate the anchor without measuring every row.
    let low = 0, high = rows.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (rows[middle].getBoundingClientRect().bottom <= origin) low = middle + 1
      else high = middle
    }
    const row = rows[low]
    const next: TableScrollPosition = { query: effectiveQuery, view, scope: cacheKey, top: el.scrollTop, left: el.scrollLeft,
      anchor: row?.dataset.rowId, offset: row ? row.getBoundingClientRect().top - origin : undefined }
    position.current = next
    if (cacheKey) {
      returnPositions.delete(cacheKey)
      returnPositions.set(cacheKey, next)
      if (returnPositions.size > 30) returnPositions.delete(returnPositions.keys().next().value!)
    }
  }, [effectiveQuery, view, cacheKey, position, scrollRef])

  const rememberFrame = React.useRef<number | undefined>(undefined)
  const rememberAfterRender = React.useCallback(() => {
    if (rememberFrame.current !== undefined) cancelAnimationFrame(rememberFrame.current)
    rememberFrame.current = requestAnimationFrame(remember)
  }, [remember])
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !virtualized) return
    const observer = new MutationObserver(rememberAfterRender)
    observer.observe(el, { childList: true, subtree: true })
    return () => { observer.disconnect(); if (rememberFrame.current !== undefined) cancelAnimationFrame(rememberFrame.current) }
  }, [ready, revision, virtualized, rememberAfterRender, scrollRef])

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.style.removeProperty("max-height")
    // CSS math/variables may be syntactically valid but resolve to zero or negative.
    // Fall back to natural height instead of making the data inaccessible.
    if (bounded && !fill && el.clientHeight === 0 && el.scrollHeight > 0) el.style.maxHeight = "none"
  }, [maxHeight, bounded, fill, ready])

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !ready) return
    const previous = position.current && position.current.scope === cacheKey ? position.current : (cacheKey ? returnPositions.get(cacheKey) : undefined)
    const restore = () => {
      const sameView = previous?.view === view
      const sameQuery = sameView && previous?.query === effectiveQuery
      el.scrollLeft = sameView ? previous?.left ?? 0 : 0
      lastScrollLeftRef.current = el.scrollLeft
      el.scrollTop = sameQuery ? previous?.top ?? 0 : 0
      if (sameQuery && previous?.anchor) {
        const row = Array.from(el.querySelectorAll<HTMLElement>("tbody tr[data-row-id]")).find(row => row.dataset.rowId === previous.anchor)
        if (restoreVirtualAnchor?.current?.(previous.anchor, previous.offset ?? 0)) {
          // The virtual body resolves offscreen anchors by stable row ID.
        } else if (row) {
          const origin = el.getBoundingClientRect().top + (el.querySelector("thead")?.getBoundingClientRect().height ?? 0)
          el.scrollTop += row.getBoundingClientRect().top - origin - (previous.offset ?? 0)
        }
      }
      remember()
    }
    // On mount the virtualizer attaches its scroll element after refs commit.
    // Restore once its total-height spacer exists; do not cache the temporary top=0.
    if (restoreVirtualAnchor?.current) {
      restoringRef.current = true
      const frame = requestAnimationFrame(() => { restoringRef.current = false; restore() })
      return () => { cancelAnimationFrame(frame); restoringRef.current = false }
    }
    restore()
  }, [effectiveQuery, view, ready, revision, cacheKey, remember, position, restoreVirtualAnchor, scrollRef, virtualized])

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    lastScrollLeftRef.current = el.scrollLeft
    const updateEdges = (scrolling?: boolean) => {
      // Modern RTL scrollers start at zero and move toward negative scrollLeft.
      // Clamp overscroll so elastic scrolling cannot invent another edge.
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
      const progress = Math.min(maxScroll, Math.max(0, getComputedStyle(el).direction === "rtl" ? -el.scrollLeft : el.scrollLeft))
      const hasStart = progress > 1
      const hasEnd = maxScroll - progress > 1
      const scrollbar = Math.max(0, el.offsetWidth - el.clientWidth)
      let start = 0
      let end = 0
      const row = el.querySelector("thead tr:last-child")
      if (row) {
        for (const cell of row.querySelectorAll<HTMLElement>("th")) {
          if (cell.style.position !== "sticky") continue
          if (cell.style.insetInlineStart !== "") start += cell.offsetWidth
          else if (cell.style.insetInlineEnd !== "") end += cell.offsetWidth
        }
      }
      setEdges(old => {
        const nextScrolling = scrolling ?? old.scrolling
        return old.hasStart === hasStart && old.hasEnd === hasEnd && old.scrollbar === scrollbar && old.start === start && old.end === end && old.scrolling === nextScrolling
          ? old
          : { hasStart, hasEnd, scrollbar, start, end, scrolling: nextScrolling }
      })
    }
    const onScroll = () => {
      const movedHorizontally = el.scrollLeft !== lastScrollLeftRef.current
      lastScrollLeftRef.current = el.scrollLeft
      if (movedHorizontally) {
        if (scrollTimerRef.current !== undefined) window.clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = window.setTimeout(() => {
          setEdges(old => (old.scrolling ? { ...old, scrolling: false } : old))
        }, 200)
        updateEdges(true)
      } else {
        updateEdges()
      }
    }
    updateEdges(false)
    const observer = new ResizeObserver(() => updateEdges())
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener("scroll", onScroll)
      if (scrollTimerRef.current !== undefined) window.clearTimeout(scrollTimerRef.current)
    }
  }, [revision, ready])

  return (
    <div className={cn("data-table-viewport flex min-h-0 min-w-0 flex-col", fill && "min-h-24 flex-1")}
      data-bounded={bounded || undefined} data-mobile-content={!fill && config?.mobileContent || undefined}
      style={{ "--table-max-height": maxHeight } as React.CSSProperties}>
      <div className={cn("relative min-h-0 min-w-0", fill && "flex flex-1 flex-col")}>
        <div ref={attachScroll} data-slot="table-container" data-sticky-header={bounded && config?.stickyHeader !== false || undefined}
          className={cn("data-table-scrollbar relative w-full overflow-auto rounded-t-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", fill && "min-h-24 flex-1")}
          style={virtualized ? { overflowAnchor: "none" } : undefined}
          tabIndex={0} role="region" aria-label="表格数据" onScroll={virtualized ? rememberAfterRender : remember}>
          {children}
        </div>
        {updating && <div role="progressbar" aria-label="正在更新表格数据" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 w-full overflow-hidden bg-primary/15"><div className="h-full w-1/3 bg-primary animate-[var(--animate-progress-indeterminate)] motion-reduce:animate-none" /></div>}
        {/* Clip decorations separately so the scroll region keeps its focus ring. */}
        <div data-slot="scroll-edge-layer" className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-lg">
          <div data-slot="scroll-edge-left" aria-hidden="true" style={{ insetInlineStart: edges.start ? `${edges.start}px` : (pinOffsets?.start ?? "0px") }} className={cn("pointer-events-none absolute inset-y-0 start-0 z-40 w-3 bg-gradient-to-r from-foreground/15 to-transparent rtl:bg-gradient-to-l transition-opacity duration-150 motion-reduce:transition-none", edges.start > 0 && edges.scrolling && edges.hasStart ? "opacity-100" : "opacity-0")} />
          <div data-slot="scroll-edge-right" aria-hidden="true" style={{ insetInlineEnd: edges.end ? `${edges.end + edges.scrollbar}px` : edges.scrollbar ? `calc(${pinOffsets?.end ?? "0px"} + ${edges.scrollbar}px)` : (pinOffsets?.end ?? "0px") }} className={cn("pointer-events-none absolute inset-y-0 end-0 z-40 w-3 bg-gradient-to-l from-foreground/15 to-transparent rtl:bg-gradient-to-r transition-opacity duration-150 motion-reduce:transition-none", edges.end > 0 && edges.scrolling && edges.hasEnd ? "opacity-100" : "opacity-0")} />
        </div>
      </div>
    </div>
  )
}
