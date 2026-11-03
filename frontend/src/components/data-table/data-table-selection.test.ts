import { describe, expect, it } from "vitest"
import { selectedOnPage, updatePageSelection } from "./data-table-selection"
import { loadedRowsTSV, spreadsheetText } from "./data-table-clipboard"

describe("bounded table selection", () => {
  it("preserves off-page ids while toggling the visible page", () => {
    expect(updatePageSelection({ mode: "ids", ids: ["a", "b"] }, ["b", "c"], { c: true })).toEqual({
      mode: "ids",
      ids: ["a", "c"],
    })
  })
  it("tracks all-matching exclusions without materializing ids", () => {
    const next = updatePageSelection({ mode: "allMatching", excludedIds: ["a"] }, ["b", "c"], {
      c: true,
    })
    expect(next).toEqual({ mode: "allMatching", excludedIds: ["a", "b"] })
    expect(selectedOnPage(next, ["a", "b", "c", "d"])).toEqual({ c: true, d: true })
  })
  it("bounds both explicit ids and exclusions", () => {
    const ids = Array.from({ length: 500 }, (_, i) => String(i))
    expect(() => updatePageSelection({ mode: "ids", ids }, ["extra"], { extra: true })).toThrow(
      "500",
    )
    expect(() =>
      updatePageSelection({ mode: "allMatching", excludedIds: ids }, ["extra"], {}),
    ).toThrow("500")
  })
  it("page mode discards stale off-page ids", () => {
    expect(updatePageSelection({ mode: "page", ids: ["old"] }, ["new"], { new: true })).toEqual({
      mode: "page",
      ids: ["new"],
    })
  })
})
describe("spreadsheet copy", () => {
  it("escapes formulas, tabs, quotes and multiline cells", () => {
    expect(loadedRowsTSV([[" =SUM(1,2)", 'a"b\nc', "x\ty"]])).toBe(
      '\' =SUM(1,2)\t"a""b\nc"\t"x\ty"',
    )
  })
  it("preserves bigint strings and rejects already imprecise numbers", () => {
    expect(spreadsheetText(9007199254740993n)).toBe("9007199254740993")
    expect(() => spreadsheetText(9007199254740992)).toThrow("大整数")
  })
})
