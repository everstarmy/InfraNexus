export type DataTableDensity = "compact" | "standard" | "comfortable"

export type DataTableViewport = (
  | { mode: "content"; maxHeight?: never }
  | { mode: "max-height"; maxHeight: string | number }
  | { mode: "fill"; maxHeight?: never }
) & {
  /** Keep natural page scrolling below Tailwind's md breakpoint. */
  mobileContent?: boolean
  stickyHeader?: boolean
  /** Committed external query/scope. Changes reset vertical scroll. */
  queryKey?: string
  /** Defer reset/restoration while rows belong to a previous query. */
  pending?: boolean
  /** Explicit view changes reset both axes. */
  viewKey?: string
  /** User/table-scoped in-memory return-position cache; no row data is stored. */
  restoreKey?: string
}

export interface DataTableText {
  mode: "truncate" | "wrap" | "clamp"
  lines?: number
  /** Accessible label for the full-text popover. */
  label?: string
}

export function isDensity(value: unknown): value is DataTableDensity {
  return value === "compact" || value === "standard" || value === "comfortable"
}

export function viewportHeight(value: string | number): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? `${value}px` : undefined
  const height = value.trim()
  if (!height || /^(auto|none|inherit|initial|unset|revert|min-content|max-content|fit-content|stretch|contain)/i.test(height) || /^\+?0+(\.0+)?[a-z%]*$/i.test(height) || height.startsWith("-")) return undefined
  return typeof CSS !== "undefined" && CSS.supports("max-height", height) ? height : undefined
}
