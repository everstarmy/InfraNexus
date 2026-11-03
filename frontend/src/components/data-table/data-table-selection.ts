export type TableSelection =
  { mode: "page" | "ids"; ids: string[] } | { mode: "allMatching"; excludedIds: string[] }

export const selectionLimit = 500
export function selectedOnPage(selection: TableSelection, ids: string[]): Record<string, true> {
  const values = new Set(selection.mode === "allMatching" ? selection.excludedIds : selection.ids)
  return Object.fromEntries(
    ids
      .filter((id) => (selection.mode === "allMatching" ? !values.has(id) : values.has(id)))
      .map((id) => [id, true as const]),
  )
}
export function updatePageSelection(
  selection: TableSelection,
  pageIds: string[],
  next: Record<string, boolean>,
): TableSelection {
  const values = new Set(
    selection.mode === "allMatching"
      ? selection.excludedIds
      : selection.mode === "page"
        ? []
        : selection.ids,
  )
  for (const id of pageIds) {
    const include = selection.mode === "allMatching" ? !next[id] : !!next[id]
    if (include) values.add(id)
    else values.delete(id)
  }
  if (values.size > selectionLimit) throw new Error("选择或排除集合最多 500 条，请缩小筛选范围")
  return selection.mode === "allMatching"
    ? { mode: "allMatching", excludedIds: [...values] }
    : { mode: selection.mode, ids: [...values] }
}
