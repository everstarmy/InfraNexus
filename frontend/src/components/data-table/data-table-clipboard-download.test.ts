// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Table } from "./types"
import { exportLoadedRowsCSV } from "./data-table-clipboard"

const NativeURL = URL
const createObjectURL = vi.fn(() => "blob:stability-export")
const revokeObjectURL = vi.fn()
function tableWith(value: unknown): Table<{ value: unknown }> {
  return {
    getStartVisibleLeafColumns: () => [],
    getCenterVisibleLeafColumns: () => [{ id: "value", columnDef: { header: "值" } }],
    getEndVisibleLeafColumns: () => [],
    getRowModel: () => ({ rows: [{ getValue: () => value }] }),
  } as unknown as Table<{ value: unknown }>
}
beforeEach(() => {
  vi.useFakeTimers()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    },
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it("removes its anchor immediately and revokes the URL on the actual scheduled task", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.isConnected).toBe(true)
    expect(this.download).toBe("中文.csv")
    expect(this.href).toBe("blob:stability-export")
  })
  expect(exportLoadedRowsCSV(tableWith('中文,"引用"\r\n新行\ttab'), { filename: "中文.csv" })).toBe(
    '\ufeff值\r\n"中文,""引用""\r\n新行\ttab"',
  )
  expect(click).toHaveBeenCalledOnce()
  expect(createObjectURL).toHaveBeenCalledOnce()
  expect(document.querySelector('a[download="中文.csv"]')).toBeNull()
  expect(revokeObjectURL).not.toHaveBeenCalled()
  await vi.runAllTimersAsync()
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:stability-export")
  expect(vi.getTimerCount()).toBe(0)
})
it("cleans anchor and URL even when a click fails", async () => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    throw new Error("click failed")
  })
  expect(() => exportLoadedRowsCSV(tableWith("x"), { filename: "failed.csv" })).toThrow(
    "click failed",
  )
  expect(document.querySelector('a[download="failed.csv"]')).toBeNull()
  await vi.runAllTimersAsync()
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:stability-export")
})
it("serialization failures allocate neither browser resources nor cleanup timers", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
  for (const value of [
    9007199254740992,
    {
      toString() {
        throw new Error("cannot serialize")
      },
    },
  ]) {
    expect(() => exportLoadedRowsCSV(tableWith(value), { filename: "invalid.csv" })).toThrow()
  }
  expect(createObjectURL).not.toHaveBeenCalled()
  expect(click).not.toHaveBeenCalled()
  expect(document.querySelector('a[download="invalid.csv"]')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  await vi.runAllTimersAsync()
  expect(revokeObjectURL).not.toHaveBeenCalled()
})
it("returning CSV without filename creates no download resources", () => {
  expect(exportLoadedRowsCSV(tableWith(null))).toBe("\ufeff值\r\n")
  expect(createObjectURL).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
