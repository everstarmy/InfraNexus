import { describe, expect, it } from "vitest"
import {
  computeTableGeometry,
  normalizeColumnPinning,
  geometryWidth,
  type ComputeTableGeometryInput,
  type TableGeometryResult,
  type ComputedColumnGeometry,
  type GeometryColumnInput,
} from "./data-table-geometry"
const cases = [false, true].flatMap((hasSelect) =>
  [false, true].flatMap((hasDetail) =>
    [[], ["username"], ["select", "__detail", "username"]].flatMap((start) =>
      [[], ["actions"], ["status", "actions"]].flatMap((end) =>
        [false, true].flatMap((sizedLayout) =>
          [390, 595, 768, 1280].map((containerWidth) => ({
            hasSelect,
            hasDetail,
            start,
            end,
            sizedLayout,
            containerWidth,
          })),
        ),
      ),
    ),
  ),
)
describe.each(cases)("geometry %j", (c) => {
  it("preserves auxiliary pixels, ordered offsets, budget and a single grow column", () => {
    const columns = [
      ...(c.hasSelect ? [{ id: "select", size: 42, minSize: 42, maxSize: 42 }] : []),
      ...(c.hasDetail ? [{ id: "__detail", size: 36, minSize: 36, maxSize: 36 }] : []),
      { id: "username", size: 280 },
      { id: "status", size: 120 },
      { id: "actions", size: 54 },
    ]
    const pinning = normalizeColumnPinning(
      { start: c.start, end: c.end },
      { columnIds: columns.map((c) => c.id), stickyActionColumn: true },
    )
    const g = computeTableGeometry({
      columns,
      pinning,
      sizedLayout: c.sizedLayout,
      containerWidth: c.containerWidth,
      narrowPinnedColumns: true,
    })
    expect(Object.values(g.columnsById).filter((c) => c.isGrowColumn).length).toBeLessThanOrEqual(
      c.sizedLayout ? 1 : 0,
    )
    for (const side of ["start", "end"] as const) {
      const ids =
        side === "start" ? g.effectivePinning.start : [...g.effectivePinning.end].reverse()
      let offset = 0
      for (const id of ids) {
        expect(g.columnsById[id][side === "start" ? "startOffset" : "endOffset"]).toBe(offset)
        offset += g.columnsById[id].width
      }
    }
    if (c.hasSelect) expect(g.columnsById.select.width).toBe(42)
    if (c.hasDetail) expect(g.columnsById.__detail.width).toBe(36)
    if (g.growColumnId)
      expect(g.columnsById[g.growColumnId].renderWidth).toBe(`calc(100% - ${g.otherWidth}px)`)
    if (c.hasSelect && c.hasDetail && c.start.includes("select"))
      expect(g.columnsById.__detail.startOffset).toBe(42)
  })
})

describe("geometry edge cases", () => {
  it("preserves data pins on unmeasured initial frame (containerWidth = 0) and skips enableResizing=false for grow column", () => {
    const g = computeTableGeometry({
      columns: [
        { id: "code", size: 120, enableResizing: false },
        { id: "name", size: 200 },
        { id: "status", size: 100 },
      ],
      pinning: { start: ["code"], end: [] },
      sizedLayout: true,
      containerWidth: 0,
      narrowPinnedColumns: true,
    })
    expect(g.effectivePinning.start).toEqual(["code"])
    expect(g.growColumnId).toBe("name")

    const gUnpinned = computeTableGeometry({
      columns: [
        { id: "code", size: 120, enableResizing: false },
        { id: "name", size: 200 },
      ],
      pinning: { start: [], end: [] },
      sizedLayout: true,
      containerWidth: 800,
      narrowPinnedColumns: false,
    })
    expect(gUnpinned.growColumnId).toBe("name")
  })
})

// Frozen pre-refactor implementation, used only as an equivalence oracle.
const auxiliary = new Set(["select", "__detail", "actions"])
function legacyGeometry(input: ComputeTableGeometryInput): TableGeometryResult {
  const { columns, pinning, containerWidth, sizedLayout } = input
  const budget = Math.max(0, containerWidth - Math.min(240, Math.max(160, containerWidth * 0.3)))
  const data = (c: GeometryColumnInput) =>
    c.isDataColumn ?? (!c.isActionColumn && !auxiliary.has(c.id))
  const configured = columns.filter(
    (c) => pinning.start.includes(c.id) || pinning.end.includes(c.id),
  )
  const effective = new Set<string>()
  let pinnedWidth = 0
  for (const c of [...configured.filter((c) => !data(c)), ...configured.filter(data)]) {
    if (
      (input.enableColumnPinning !== false || (input.stickyActionColumn && c.id === "actions")) &&
      (!input.narrowPinnedColumns ||
        containerWidth <= 0 ||
        !data(c) ||
        pinnedWidth + c.size <= budget)
    ) {
      effective.add(c.id)
      pinnedWidth += c.size
    }
  }
  const start = columns.filter((c) => effective.has(c.id) && pinning.start.includes(c.id))
  const end = columns.filter((c) => effective.has(c.id) && pinning.end.includes(c.id))
  const grow = sizedLayout
    ? columns.find(
        (c) =>
          data(c) &&
          c.enableResizing !== false &&
          !(c.minSize !== undefined && c.minSize === c.maxSize) &&
          !effective.has(c.id),
      )
    : undefined
  const totalWidth = columns.reduce((sum, c) => sum + c.size, 0)
  const otherWidth = totalWidth - (grow?.size ?? 0)
  const columnsById: Record<string, ComputedColumnGeometry> = Object.create(null)
  for (const c of columns) {
    const si = start.findIndex((item) => item.id === c.id),
      ei = end.findIndex((item) => item.id === c.id)
    columnsById[c.id] = {
      width: c.size,
      renderWidth: c.id === grow?.id ? `calc(100% - ${otherWidth}px)` : c.size,
      isGrowColumn: c.id === grow?.id,
      pinPosition: si >= 0 ? "start" : ei >= 0 ? "end" : false,
      startOffset: si >= 0 ? start.slice(0, si).reduce((s, c) => s + c.size, 0) : undefined,
      endOffset: ei >= 0 ? end.slice(ei + 1).reduce((s, c) => s + c.size, 0) : undefined,
      isLastStartPinned: si >= 0 && si === start.length - 1,
      isFirstEndPinned: ei === 0,
    }
  }
  return {
    effectivePinning: { start: start.map((c) => c.id), end: end.map((c) => c.id) },
    totalWidth,
    growColumnId: grow?.id,
    otherWidth,
    columnsById,
  }
}

describe("linear geometry equivalence", () => {
  const catalog = [
    { id: "select", size: 42, isDataColumn: false },
    { id: "a", size: 100.1 },
    { id: "b", size: 130.2 },
    { id: "c", size: 90.3 },
    { id: "actions", size: 54, isDataColumn: false },
  ]
  for (const columns of [
    [],
    catalog,
    catalog.filter((c) => c.id !== "b"),
    [...catalog, { id: "a", size: 71.7 }],
  ])
    for (const pinning of [
      { start: [], end: [] },
      { start: ["a", "missing"], end: ["b", "actions"] },
      { start: columns.map((c) => c.id), end: [] },
      { start: [], end: columns.map((c) => c.id) },
      { start: ["a", "a", "b"], end: ["a", "c", "actions", "missing"] },
    ])
      for (const containerWidth of [0, 390, 595, 768, 1280])
        for (const sizedLayout of [false, true])
          it(`matches legacy offsets: ${JSON.stringify({ columns, pinning, containerWidth, sizedLayout })}`, () => {
            const input = {
              columns,
              pinning,
              containerWidth,
              sizedLayout,
              narrowPinnedColumns: true,
            }
            const actual = computeTableGeometry(input)
            const expected = legacyGeometry(input)
            expect(actual.effectivePinning).toEqual(expected.effectivePinning)
            expect(actual.totalWidth).toBe(expected.totalWidth)
            expect(actual.growColumnId).toBe(expected.growColumnId)
            for (const id of Object.keys(expected.columnsById)) {
              const { startOffset, endOffset, ...rest } = actual.columnsById[id]
              const {
                startOffset: start,
                endOffset: end,
                ...expectedRest
              } = expected.columnsById[id]
              expect(rest).toEqual(expectedRest)
              if (start === undefined) expect(startOffset).toBeUndefined()
              else expect(startOffset).toBeCloseTo(start, 10)
              if (end === undefined) expect(endOffset).toBeUndefined()
              else expect(endOffset).toBeCloseTo(end, 10)
            }
          })
  it("retains inclusive narrow budget boundary and auxiliary priority", () => {
    const input = {
      columns: [
        { id: "data", size: 230 },
        { id: "actions", size: 10, isDataColumn: false },
      ],
      pinning: { start: ["data"], end: ["actions"] },
      sizedLayout: true,
      containerWidth: 400,
      narrowPinnedColumns: true,
    }
    expect(computeTableGeometry(input).effectivePinning).toEqual({
      start: ["data"],
      end: ["actions"],
    })
    expect(
      computeTableGeometry({ ...input, columns: [{ id: "data", size: 230.01 }, input.columns[1]] })
        .effectivePinning,
    ).toEqual({ start: [], end: ["actions"] })
  })
  it("aggregates grouped visible leaf widths including the one grow column", () => {
    const g = computeTableGeometry({
      columns: catalog,
      pinning: { start: ["select"], end: ["actions"] },
      containerWidth: 1000,
      sizedLayout: true,
      narrowPinnedColumns: false,
    })
    expect(geometryWidth(g, ["missing", "select", "actions"])).toBe("96px")
    expect(geometryWidth(g, ["a", "b"])).toBe(
      `calc(100% - ${g.totalWidth - (catalog[1].size + catalog[2].size)}px)`,
    )
    expect(geometryWidth(g, [])).toBe("0px")
  })
})
