// @vitest-environment happy-dom
import { act } from "react"
import { expect, it, vi } from "vitest"
import { renderHook } from "./test/render-hook"
import { useServerTable } from "./use-server-table"
it("debounces keywords, resets pagination and preserves sorting on filter reset", () => {
  vi.useFakeTimers()
  const h = renderHook(() => useServerTable({ initialFilters: { state: 1 }, debounceMs: 300 }))
  act(() => h.current.onPaginationChange({ pageIndex: 4, pageSize: 20 }))
  act(() => h.current.setKeyword("hello"))
  expect(h.current.pagination.pageIndex).toBe(0)
  expect(h.current.debouncedKeyword).toBe("")
  act(() => vi.advanceTimersByTime(300))
  expect(h.current.queryParams.keyword).toBe("hello")
  act(() => h.current.onSortingChange([{ id: "name", desc: true }]))
  act(() => h.current.setFilter("state", 2))
  expect(h.current.filters.state).toBe(2)
  act(() => h.current.resetFilters())
  expect(h.current.queryParams.keyword).toBe("")
  expect(h.current.filters.state).toBe(1)
  expect(h.current.sorting).toEqual([{ id: "name", desc: true }])
  act(() => h.current.onPaginationChange({ pageIndex: 3, pageSize: 20 }))
  expect(h.current.pagination.pageIndex).toBe(3)
  act(() => h.current.onPaginationChange({ pageIndex: 3, pageSize: 50 }))
  expect(h.current.pagination).toEqual({ pageIndex: 0, pageSize: 50 })
  h.unmount()

  const hWithInitial = renderHook(() =>
    useServerTable({ initialKeyword: "preset-kw", debounceMs: 300 }),
  )
  act(() => hWithInitial.current.setKeyword("changed"))
  act(() => vi.advanceTimersByTime(300))
  expect(hWithInitial.current.queryParams.keyword).toBe("changed")
  act(() => hWithInitial.current.resetFilters())
  expect(hWithInitial.current.keyword).toBe("preset-kw")
  expect(hWithInitial.current.queryParams.keyword).toBe("preset-kw")
  hWithInitial.unmount()
  vi.useRealTimers()
})
