import { api } from "./api"
import type { Envelope } from "./types"
import type { TableQuery } from "@/components/data-table/data-table-query"
import type { TableSelection } from "@/components/data-table/data-table-selection"
export interface UserSelectionQuery {
  query?: TableQuery
  keyword?: string
  statuses?: number[]
  auth_types?: string[]
  role_ids?: string[]
  department_id?: string
  no_department?: boolean
  include_children?: boolean
}
export type UserSelection = (
  { mode: "page" | "ids"; ids: string[] } | { mode: "allMatching"; excluded_ids: string[] }
) & { query: UserSelectionQuery }
export function userSelection(value: TableSelection, query: UserSelectionQuery): UserSelection {
  if (value.mode === "allMatching") {
    return { mode: value.mode, excluded_ids: value.excludedIds, query }
  }
  // Explicit IDs may come from several searches. Keep the other scope filters,
  // but do not intersect those IDs with only the latest search term.
  const selectionQuery = value.mode === "ids"
    ? { ...query, keyword: undefined, query: query.query ? { ...query.query, search: "" } : undefined }
    : query
  return { ...value, query: selectionQuery }
}
export interface BatchItem {
  id: string
  revision: number
  outcome: string
  reason: string
  retryable: boolean
}
export interface BatchResult {
  success: number
  failed: number
  skipped: number
  new_matches: number
  items: BatchItem[]
}
export const userTableActions = {
  preview: (selection: UserSelection, status: number) =>
    api.post("/users/batch-status/preview", { selection, status }, { timeout: 35000 }) as Promise<
      Envelope<{ matched: number; eligible: number; skipped: number; items: BatchItem[] }>
    >,
  execute: (selection: UserSelection, status: number, items: BatchItem[]) =>
    api.post(
      "/users/batch-status",
      { selection, status, items: items.map(({ id, revision }) => ({ id, revision })) },
      { timeout: 35000 },
    ) as Promise<Envelope<BatchResult>>,
  export: (selection: UserSelection, fields: string[]) =>
    api.post(
      "/users/export",
      { selection, fields },
      { responseType: "blob", timeout: 35000 },
    ) as Promise<Blob>,
}
