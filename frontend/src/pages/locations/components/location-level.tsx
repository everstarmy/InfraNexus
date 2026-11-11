import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QueryErrorState } from "@/components/common/query-error-state"
import { useAuth } from "@/stores/auth-context"
import type { ManagedBase, ManagedQueryParams } from "@/services/managed"
import type { Envelope, PageData } from "@/services/types"

export function LocationLevel<T extends ManagedBase>({
  label,
  permission,
  queryKey,
  parentId,
  list,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
}: {
  label: string
  permission: string
  queryKey: readonly string[]
  parentId?: string
  list: (params: ManagedQueryParams, signal: AbortSignal) => Promise<Envelope<PageData<T>>>
  selectedId?: string
  onSelect: (item: T) => void
  onCreate?: () => void
  onEdit: (item: T) => void
}) {
  const { can } = useAuth()
  const [page, setPage] = useState(1)
  const pageSize = 20
  const canRead = can(`${permission}:read`)
  const query = useQuery({
    queryKey: [...queryKey, "topology", page],
    queryFn: ({ signal }) => list({ parent_id: parentId, page, page_size: pageSize }, signal),
    enabled: canRead,
  })
  const items = query.data?.data.items ?? []
  const total = query.data?.data.total ?? 0

  return (
    <section aria-label={label} className="space-y-1 border-b pb-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium">{label}</h3>
        {onCreate && can(`${permission}:create`) && (
          <Button size="icon-xs" variant="ghost" onClick={onCreate} aria-label={`新建${label}`}>
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>
      {!canRead ? (
        <p className="text-xs text-muted-foreground">没有查看权限</p>
      ) : query.error ? (
        <QueryErrorState label={label} error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无{label}</p>
      ) : (
        items.map((item) => (
          <div className="flex min-w-0 items-center gap-1" key={item.id}>
            <Button
              size="sm"
              variant={selectedId === item.id ? "secondary" : "ghost"}
              className="min-w-0 flex-1 justify-start"
              aria-pressed={selectedId === item.id}
              onClick={() => onSelect(item)}
            >
              <span className="truncate">{item.name}</span>
            </Button>
            {can(`${permission}:update`) && (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => onEdit(item)}
                aria-label={`编辑${item.name}`}
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
          </div>
        ))
      )}
      {(page > 1 || total > pageSize) && (
        <div className="flex justify-between">
          <Button
            size="xs"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={page * pageSize >= total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  )
}
