import type { DataTableViewport, DataTableText } from "../../../src/components/data-table/data-table-layout"
/** Deterministic synthetic data only; never load production users or permissions. */
export interface FixtureRow {
  id: string
  name: string
  description: string
  canEdit: boolean
  children?: FixtureRow[]
}

export type TableScenario =
  | 'short' | 'many' | 'wide' | 'long-text' | 'empty'
  | 'loading' | 'error' | 'tree' | 'no-permission'

export interface FixtureOptions {
  stabilityProbe?: boolean
  virtualized?: boolean
  refreshing?: boolean
  tableError?: boolean
  onRetry?: () => void
  scenario?: TableScenario
  viewport?: DataTableViewport
  controls?: boolean | { density?: boolean; fullscreen?: boolean }
  rowCount?: number
  pageSize?: number
  pageSizeOptions?: number[]
  maxPageSize?: number
  grouped?: boolean
  stickyOnly?: boolean
  pinned?: boolean
  pinConflict?: boolean
  advanced?: boolean
  externalDate?: boolean
  textValue?: string
  details?: boolean
  text?: DataTableText
  preference?: boolean
  parentHeight?: number
  interactive?: boolean
  hideRefresh?: boolean
  hideViewOptions?: boolean
  showViewOptions?: boolean
  hideSearch?: boolean
  slots?: boolean
  title?: boolean
  legacy?: boolean
}

export function makeRows(count: number, prefix = 'row'): FixtureRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    name: index === 0 ? 'Alpha' : index === 1 ? 'Beta' : `成员 ${index + 1}`,
    description: `说明 ${index + 1}`,
    canEdit: true,
  }))
}

export function scenarioRows(scenario: TableScenario): FixtureRow[] {
  switch (scenario) {
    case 'empty': case 'loading': return []
    case 'many': return makeRows(120)
    case 'long-text': return makeRows(2).map(row => ({ ...row, description: '用于验证长文本边界与可读性的说明。'.repeat(24) }))
    case 'tree': return [{ ...makeRows(1, 'root')[0], name: '根节点', children: makeRows(3, 'child') }]
    case 'no-permission': return makeRows(2).map(row => ({ ...row, canEdit: false }))
    default: return makeRows(2)
  }
}
