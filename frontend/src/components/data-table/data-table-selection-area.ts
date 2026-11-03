import type { ReactNode } from 'react'

/** The host owns IDs, query-wide selection, authorization and pending operations. */
export interface DataTableSelectionArea {
  count: number
  currentPageCount: number
  estimated?: boolean
  disabled?: boolean
  onClear: () => void
  selectAll?: { count: number; onSelect: () => void }
  /** Remains mounted when count is zero so export/results and pending state survive. */
  actions: ReactNode
}
