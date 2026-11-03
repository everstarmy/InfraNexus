// @vitest-environment happy-dom
import { act } from "react"
import { expect, it } from "vitest"
import { renderHook } from "./test/render-hook"
import { useColumnPreferences } from "./use-column-preferences"
it("sanitizes and persists column preferences without leaking between scopes", () => {
  localStorage.clear()
  const result = renderHook(() =>
    useColumnPreferences({
      columns: [{ accessorKey: "name" }],
      initialColumnVisibility: {},
      initialColumnPinning: { start: [], end: [] },
      tablePreference: { userId: "u", tableId: "t", schemaVersion: 1 },
    }),
  )
  act(() => result.current.updateColumnPreference("density", "compact"))
  expect(result.current.activeColumnPreferences.density).toBe("compact")
  expect(JSON.parse(localStorage.getItem(result.current.storageKey!)!).density).toBe("compact")
  act(() => result.current.resetColumnPreferences())
  expect(result.current.activeColumnPreferences.density).toBe("standard")
  result.unmount()
})
it("delegates controlled updates and reset to the host without persisting its layout", () => {
  let nextDensity = ""
  const value = {
    density: "standard" as const,
    columnVisibility: {},
    columnPinning: { start: [], end: [] },
    columnSizing: {},
    columnOrder: ["name"],
  }
  const h = renderHook(() =>
    useColumnPreferences({
      columns: [{ accessorKey: "name" }],
      initialColumnVisibility: {},
      initialColumnPinning: { start: [], end: [] },
      layoutState: {
        value,
        onChange: (next) => {
          nextDensity = next.density
        },
      },
    }),
  )
  act(() =>
    h.current.updateColumnPreference("density", (prev) =>
      prev === "standard" ? "compact" : "standard",
    ),
  )
  expect(nextDensity).toBe("compact")
  expect(h.current.activeColumnPreferences.density).toBe("standard")
  act(() => h.current.resetColumnPreferences())
  expect(nextDensity).toBe("standard")
  h.unmount()
})
