import { viewportHeight, type DataTableViewport } from "./data-table-layout"

interface VirtualCompatibilityInput {
  requested: boolean
  hasStableRowId: boolean
  hasDetail: boolean
  hasGroup: boolean
  fill: boolean
  viewport?: DataTableViewport
  compatibilityMode: boolean
  rowCount: number
}
/** Keep fallback priority and messages aligned with the original opt-in contract. */
export function resolveVirtualCompatibility(input: VirtualCompatibilityInput): {
  enabled: boolean
  fallback: string | undefined
} {
  const fallback = !input.requested
    ? undefined
    : !input.hasStableRowId
      ? "需要稳定的 getRowId"
      : input.hasDetail || input.hasGroup
        ? "行详情或行分组请使用分页模式"
        : !input.fill &&
            (input.viewport?.mode !== "max-height" ||
              !viewportHeight(input.viewport.maxHeight) ||
              input.viewport.mobileContent)
          ? "需要固定高度视口，并关闭 mobileContent"
          : undefined
  return {
    fallback,
    enabled: input.requested && !fallback && !input.compatibilityMode && input.rowCount > 0,
  }
}
