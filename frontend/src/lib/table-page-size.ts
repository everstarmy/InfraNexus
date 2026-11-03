export interface TablePageSizePolicy {
  pageSizeOptions?: readonly number[]
  defaultPageSize?: number
  maxPageSize?: number
}
export function tablePageSizes(policy: TablePageSizePolicy = {}) {
  const max = Number.isSafeInteger(policy.maxPageSize) && policy.maxPageSize! > 0 ? policy.maxPageSize! : 100
  const options = [...new Set(policy.pageSizeOptions ?? [10, 20, 50, 100])].filter(size => Number.isSafeInteger(size) && size > 0 && size <= max)
  if (!options.length) options.push(Math.min(10, max))
  const fallback = options.includes(policy.defaultPageSize ?? 10) ? (policy.defaultPageSize ?? 10) : options[0]
  return { options, fallback }
}
export function resolveTablePageSize(value: unknown, policy: TablePageSizePolicy = {}) {
  const { options, fallback } = tablePageSizes(policy)
  return typeof value === 'number' && options.includes(value) ? value : fallback
}
