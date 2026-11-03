import { describe, expect, it } from "vitest"
import { resolveVirtualCompatibility } from "./data-table-compatibility"

const base = {
  requested: true,
  hasStableRowId: true,
  hasDetail: false,
  hasGroup: false,
  fill: false,
  viewport: { mode: "max-height" as const, maxHeight: 400 },
  compatibilityMode: false,
  rowCount: 20,
}
const cases = [
  {
    name: "not requested",
    patch: { requested: false, hasStableRowId: false },
    enabled: false,
    fallback: undefined,
  },
  { name: "bounded stable IDs", patch: {}, enabled: true, fallback: undefined },
  {
    name: "fill bypasses mobile max-height check",
    patch: { fill: true, viewport: { mode: "content" as const, mobileContent: true } },
    enabled: true,
    fallback: undefined,
  },
  {
    name: "no stable ID takes priority over detail and height",
    patch: { hasStableRowId: false, hasDetail: true, viewport: undefined },
    enabled: false,
    fallback: "需要稳定的 getRowId",
  },
  {
    name: "detail takes priority over height",
    patch: { hasDetail: true, viewport: undefined },
    enabled: false,
    fallback: "行详情或行分组请使用分页模式",
  },
  {
    name: "flat group",
    patch: { hasGroup: true },
    enabled: false,
    fallback: "行详情或行分组请使用分页模式",
  },
  {
    name: "mobile content",
    patch: { viewport: { ...base.viewport, mobileContent: true } },
    enabled: false,
    fallback: "需要固定高度视口，并关闭 mobileContent",
  },
  ...[0, -1, NaN, Infinity, "auto", "0px", "-10px"].map((maxHeight) => ({
    name: `invalid height ${maxHeight}`,
    patch: { viewport: { ...base.viewport, maxHeight } },
    enabled: false,
    fallback: "需要固定高度视口，并关闭 mobileContent",
  })),
  {
    name: "natural viewport",
    patch: { viewport: undefined },
    enabled: false,
    fallback: "需要固定高度视口，并关闭 mobileContent",
  },
  {
    name: "manual compatibility mode",
    patch: { compatibilityMode: true },
    enabled: false,
    fallback: undefined,
  },
  { name: "empty row model", patch: { rowCount: 0 }, enabled: false, fallback: undefined },
]
describe.each(cases)("virtual compatibility: $name", ({ patch, enabled, fallback }) => {
  it("preserves enabled state and fallback priority", () => {
    expect(resolveVirtualCompatibility({ ...base, ...patch })).toEqual({ enabled, fallback })
  })
})
