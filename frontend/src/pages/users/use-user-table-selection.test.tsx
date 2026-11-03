// @vitest-environment happy-dom
import { act, useState } from "react"
import { expect, it, vi } from "vitest"
import { renderHook } from "@/components/data-table/test/render-hook"
import { selectedOnPage, updatePageSelection } from "@/components/data-table/data-table-selection"
import { emptyQuery } from "@/components/data-table/data-table-query"
import { userSelection } from "@/services/user-table-actions"
import { notify } from "@/lib/notify"
import { useUserTableSelection } from "./use-user-table-selection"

vi.mock("@/lib/notify", () => ({ notify: { info: vi.fn() } }))
vi.mock("@/services/api", () => ({ api: {} }))

function setup() {
  return renderHook(() => {
    const [scope, setScope] = useState("user:filters")
    const [query, setQuery] = useState("A")
    const [page, setPage] = useState("0:20")
    return { ...useUserTableSelection(scope, query, page), setScope, setQuery, setPage }
  })
}

it("accumulates selections across searches and submits all IDs without the latest search", () => {
  const h = setup()
  act(() => h.current.changeSelection({ mode: "ids", ids: ["a"] }))
  act(() => h.current.setQuery("B"))
  expect(h.current.selection).toEqual({ mode: "ids", ids: ["a"] })
  act(() => h.current.changeSelection(updatePageSelection(h.current.selection, ["b"], { b: true })))
  act(() => h.current.setPage("1:20"))
  expect(h.current.selection).toEqual({ mode: "ids", ids: ["a", "b"] })
  const descriptor = userSelection(h.current.selection, {
    keyword: "B", query: { ...emptyQuery(), search: "B" }, statuses: [1],
  })
  expect(descriptor).toMatchObject({ mode: "ids", ids: ["a", "b"], query: { statuses: [1], query: { search: "" } } })
  expect(descriptor.query.keyword).toBeUndefined()
  act(() => h.current.setQuery(""))
  expect(selectedOnPage(h.current.selection, ["a", "b", "c"])).toEqual({ a: true, b: true })
  act(() => h.current.changeSelection(updatePageSelection(h.current.selection, ["a"], {})))
  expect(h.current.selection).toEqual({ mode: "ids", ids: ["b"] })
  act(() => h.current.changeSelection({ mode: "ids", ids: [] }))
  expect(h.current.selection).toEqual({ mode: "ids", ids: [] })
  h.unmount()
})

it("clears explicit IDs when filters or identity permissions change", () => {
  const h = setup()
  act(() => h.current.changeSelection({ mode: "ids", ids: ["a"] }))
  act(() => h.current.setScope("other-user:filters"))
  expect(h.current.selection).toEqual({ mode: "ids", ids: [] })
  expect(notify.info).toHaveBeenCalled()
  h.unmount()
})

it("keeps all-matching selection across pages but clears it on search changes", () => {
  const h = setup()
  act(() => h.current.changeSelection({ mode: "allMatching", excludedIds: ["a"] }))
  act(() => h.current.setPage("1:20"))
  expect(h.current.selection).toEqual({ mode: "allMatching", excludedIds: ["a"] })
  expect(userSelection(h.current.selection, { keyword: "A" }).query.keyword).toBe("A")
  act(() => h.current.setQuery("B"))
  expect(h.current.selection).toEqual({ mode: "ids", ids: [] })
  h.unmount()
})

it("keeps page selection scoped to its page and search", () => {
  const h = setup()
  for (const change of [() => h.current.setPage("1:20"), () => h.current.setQuery("B")]) {
    act(() => h.current.changeSelection({ mode: "page", ids: ["a"] }))
    expect(userSelection(h.current.selection, { keyword: "A" }).query.keyword).toBe("A")
    act(change)
    expect(h.current.selection).toEqual({ mode: "page", ids: [] })
  }
  h.unmount()
})
