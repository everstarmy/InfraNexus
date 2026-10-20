import * as React from "react"
import { SearchX, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DataTableEmptyProps {
  isFiltered?: boolean
  title?: string
  description?: string
  onResetFilters?: () => void
  action?: React.ReactNode
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
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground/70">
        {isFiltered ? (
          <SearchX className="size-6" />
        ) : (
          <Inbox className="size-6" />
        )}
      </div>
      <h3 className="text-sm font-semibold tracking-tight text-foreground">
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
