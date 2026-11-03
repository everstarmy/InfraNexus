import { parseTableQuery, type FilterGroup, type QueryField, type TableQuery } from './data-table-query'

/** Only the editor accepts unfinished numeric strings; the transport parser stays strict. */
export function applyQueryDraft(draft: TableQuery, fields: readonly QueryField[]): TableQuery {
  const normalize = (group: FilterGroup): FilterGroup => ({
    ...group,
    children: group.children.map(node => {
      if ('logic' in node) return normalize(node)
      if (!('value' in node) || fields.find(field => field.key === node.field)?.type !== 'number') return node
      const number = (value: string | number | boolean) =>
        typeof value === 'string' && value.trim() !== '' ? Number(value) : value
      return { ...node, value: Array.isArray(node.value) ? node.value.map(number) : number(node.value) } as typeof node
    }),
  })
  return parseTableQuery({ ...draft, filter: normalize(draft.filter) }, fields)
}
