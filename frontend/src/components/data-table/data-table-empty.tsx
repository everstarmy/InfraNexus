import * as React from "react"
import { Button } from "@/components/ui/button"

interface DataTableEmptyProps {
  isFiltered?: boolean
  title?: string
  description?: string
  onResetFilters?: () => void
  action?: React.ReactNode
}

function EmptyIllustration({ filtered }: { filtered: boolean }) {
  const id = React.useId()
  return (
    <svg viewBox="0 0 160 112" className="h-24 w-auto text-foreground" aria-hidden>
      <defs>
        <linearGradient id={`${id}-card`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <ellipse cx="82" cy="102" rx="54" ry="5" fill="currentColor" opacity="0.07" />
      <rect x="30" y="26" width="76" height="58" rx="10" transform="rotate(-9 68 55)" fill="var(--muted)" stroke="var(--border)" />
      <rect x="44" y="18" width="82" height="64" rx="11" fill="var(--card)" stroke="var(--border)" />
      <rect x="44" y="18" width="82" height="64" rx="11" fill={`url(#${id}-card)`} />
      <rect x="55" y="31" width="30" height="5" rx="2.5" fill="var(--primary)" opacity="0.55" />
      <rect x="55" y="43" width="58" height="4" rx="2" fill="currentColor" opacity="0.13" />
      <rect x="55" y="53" width="44" height="4" rx="2" fill="currentColor" opacity="0.13" />
      <rect x="55" y="63" width="51" height="4" rx="2" fill="currentColor" opacity="0.09" />
      {filtered ? (
        <g className="motion-safe:animate-pulse">
          <circle cx="120" cy="72" r="13" fill="var(--background)" stroke="var(--primary)" strokeWidth="4" />
          <line x1="129.5" y1="81.5" x2="139" y2="91" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round" />
        </g>
      ) : (
        <g>
          <circle cx="126" cy="22" r="11" fill="var(--primary)" />
          <path d="M126 17v10M121 22h10" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
}

export function DataTableEmpty({
  isFiltered = false,
  title,
  description,
  onResetFilters,
  action,
}: DataTableEmptyProps) {
  const defaultTitle = isFiltered ? "未找到符合条件的结果" : "暂无数据"
  const defaultDesc = isFiltered
    ? "请尝试放宽搜索关键字或清除已选的筛选器"
    : "当前列表暂无记录，您可以稍后刷新或新建一条数据"

  return (
    <div className="flex min-h-60 animate-in flex-col items-center justify-center p-8 text-center fade-in-50">
      <EmptyIllustration filtered={isFiltered} />
      <h3 className="mt-4 text-sm font-semibold tracking-tight text-foreground">
        {title ?? defaultTitle}
      </h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {description ?? defaultDesc}
      </p>
      <div className="mt-4 flex items-center gap-2">
        {isFiltered && onResetFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={onResetFilters}
            className="h-8 text-xs font-normal"
          >
            重置所有筛选
          </Button>
        )}
        {action}
      </div>
    </div>
  )
}
