import { resolveTablePageSize, type TablePageSizePolicy } from "@/lib/table-page-size"
import { parseTableQuery, type QueryField, type TableQuery } from "./data-table-query"
import type { ColumnPreferences } from "./data-table-preferences"
export interface TableViewSnapshot {
  query: TableQuery
  layout: ColumnPreferences
  pageSize: number
}
export interface SavedTableView extends TableViewSnapshot {
  id: string
  name: string
}
export interface TableViewStore {
  version: 1
  defaultId?: string
  views: SavedTableView[]
}
export const viewStorageKey = (layoutKey: string) => `${layoutKey}:views:v1`
export function decodeViews(raw: string | null, fields: readonly QueryField[], policy: TablePageSizePolicy = {}, onPageSizeFallback?: () => void): TableViewStore {
  if (!raw) return { version: 1, views: [] }
  if (raw.length > 100_000) throw new Error("保存视图数据超限")
  const store = JSON.parse(raw) as TableViewStore
  if (store.version !== 1 || !Array.isArray(store.views) || store.views.length > 20)
    throw new Error("保存视图版本不兼容")
  const ids = new Set<string>()
  const names = new Set<string>()
  const views = store.views.map((view) => {
    if (
      typeof view.id !== "string" ||
      view.id.length > 80 ||
      ids.has(view.id) ||
      typeof view.name !== "string" ||
      !view.name.trim() ||
      view.name.length > 50 ||
      names.has(view.name.trim()) ||
      !Number.isSafeInteger(view.pageSize) || view.pageSize <= 0 ||
      !view.layout ||
      typeof view.layout !== "object"
    )
      throw new Error("保存视图数据损坏")
    const pageSize = resolveTablePageSize(view.pageSize, policy)
    if (pageSize !== view.pageSize) onPageSizeFallback?.()
    ids.add(view.id)
    names.add(view.name.trim())
    return {
      id: view.id,
      name: view.name.trim(),
      query: parseTableQuery(view.query, fields, true),
      layout: view.layout,
      pageSize,
    }
  })
  return {
    version: 1,
    views,
    defaultId: ids.has(store.defaultId ?? "") ? store.defaultId : undefined,
  }
}
export function readDefaultView(
  key: string | null,
  fields: readonly QueryField[],
  policy: TablePageSizePolicy = {},
): SavedTableView | undefined {
  try {
    const store = decodeViews(key ? localStorage.getItem(viewStorageKey(key)) : null, fields, policy)
    return store.views.find((view) => view.id === store.defaultId)
  } catch {
    return undefined
  }
}
