import { useLayoutEffect, useRef, type ReactNode } from "react"
import { useNavigationType } from "react-router-dom"
import { cn } from "@/lib/utils"

export function RoutePage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const navigationType = useNavigationType()
  const initialNavigationType = useRef(navigationType).current

  useLayoutEffect(() => {
    if (initialNavigationType === "POP" || !document.activeElement?.matches(":focus-visible")) return
    const heading = ref.current?.querySelector<HTMLElement>("h1")
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
  }, [initialNavigationType])

  return (
    <div
      ref={ref}
      className={cn("space-y-5", initialNavigationType !== "POP" && "motion-safe:animate-in motion-safe:fade-in-0 duration-[180ms] ease-out")}
    >
      {children}
    </div>
  )
}

export function RoutePageSkeleton() {
  return (
    <div role="status" aria-label="正在加载页面" className="grid grid-cols-12 gap-4 md:gap-6 motion-safe:animate-pulse">
      <span className="sr-only">正在加载页面…</span>
      <div aria-hidden className="col-span-12 space-y-3 py-2">
        <div className="h-7 w-36 rounded-md bg-muted" />
        <div className="h-4 w-64 max-w-full rounded-md bg-muted" />
      </div>
      <div aria-hidden className="col-span-12 h-80 rounded-xl border bg-card" />
    </div>
  )
}
