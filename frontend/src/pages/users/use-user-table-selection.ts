import { useEffect, useState } from "react"
import type { TableSelection } from "@/components/data-table/data-table-selection"
import { notify } from "@/lib/notify"

export function useUserTableSelection(scopeKey: string, queryKey: string, pageKey: string) {
  const [state, setState] = useState({
    scopeKey, queryKey, pageKey,
    value: { mode: "ids", ids: [] } as TableSelection,
  })
  const scopeChanged = state.scopeKey !== scopeKey
  const queryChanged = state.queryKey !== queryKey && state.value.mode !== "ids"
  const pageChanged = state.pageKey !== pageKey && state.value.mode === "page"
  const invalid = scopeChanged || queryChanged || pageChanged
  const selection: TableSelection = invalid
    ? { mode: state.value.mode === "page" ? "page" : "ids", ids: [] }
    : state.value

  useEffect(() => {
    if (!invalid) return
    if ((scopeChanged || queryChanged) && (state.value.mode === "allMatching" || state.value.ids.length)) {
      notify.info("查询范围或身份权限已变化，原选择已失效")
    }
    setState({ scopeKey, queryKey, pageKey, value: { mode: state.value.mode === "page" ? "page" : "ids", ids: [] } })
  }, [invalid, scopeChanged, queryChanged, scopeKey, queryKey, pageKey, state.value])

  const changeSelection = (value: TableSelection) => setState({ scopeKey, queryKey, pageKey, value })
  return { selection, changeSelection }
}
