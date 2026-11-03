import { useLayoutEffect, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import type { DataTableText } from "./data-table-layout"

/** Only mounted, actually clipped scalar cells expose the full-text interaction. */
export function DataTableTextCell({ value, config }: { value: string; config: DataTableText }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setOverflowing(element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    document.fonts?.addEventListener("loadingdone", measure)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.fonts?.removeEventListener("loadingdone", measure) }
  }, [value, config.mode, config.lines, overflowing])
  const lines = Number.isFinite(config.lines) ? Math.max(1, Math.min(20, Math.trunc(config.lines!))) : 3
  if (config.mode === "wrap") return <span className="whitespace-normal break-words [overflow-wrap:anywhere]">{value}</span>
  const content = <span ref={textRef} className={config.mode === "truncate" ? "block truncate" : "overflow-hidden whitespace-normal break-words [overflow-wrap:anywhere]"}
    style={config.mode === "clamp" ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines } : undefined}>{value}</span>
  if (!overflowing) return <span className="block min-w-0">{content}</span>
  return <Popover open={open} onOpenChange={(next, details) => {
    const selection = window.getSelection()
    if (next && !details.event.type.startsWith("key") && textRef.current && selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(textRef.current)) return
    setOpen(next)
  }}>
    <PopoverTrigger onClick={event => {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(event.currentTarget)) event.preventDefault()
    }} className="block w-full min-w-0 select-text cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看${config.label ?? "完整内容"}`}>
      {content}
    </PopoverTrigger>
    <PopoverContent className="max-h-[60svh] max-w-[calc(100vw-2rem)] overflow-y-auto">
      <PopoverTitle>{config.label ?? "完整内容"}</PopoverTitle>
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value}</p>
    </PopoverContent>
  </Popover>
}
