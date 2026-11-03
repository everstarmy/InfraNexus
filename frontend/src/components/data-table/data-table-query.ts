import { resolveTablePageSize, type TablePageSizePolicy } from "@/lib/table-page-size"
export type QueryValue = string | number | boolean
export type FilterCondition =
  | { field: string; op: "empty" | "notEmpty" }
  | { field: string; op: "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte"; value: QueryValue }
  | { field: string; op: "in" | "between"; value: QueryValue[] }
export interface FilterGroup {
  logic: "and" | "or"
  children: (FilterCondition | FilterGroup)[]
}
export interface TableQuery {
  version: 1
  search: string
  filter: FilterGroup
  sorts: { field: string; desc: boolean }[]
}
export interface QueryField {
  key: string
  label: string
  type: "text" | "number" | "date" | "enum" | "boolean"
  options?: { value: string | number; label: string }[]
  nullable?: boolean
  sensitive?: boolean
  sortable?: boolean
}
export const emptyQuery = (): TableQuery => ({
  version: 1,
  search: "",
  filter: { logic: "and", children: [] },
  sorts: [],
})
export function operators(field: QueryField): FilterCondition["op"][] {
  const base: FilterCondition["op"][] =
    field.type === "text"
      ? ["contains", "eq", "ne"]
      : field.type === "boolean"
        ? ["eq", "ne"]
        : field.type === "enum"
          ? ["eq", "ne", "in"]
          : ["eq", "ne", "gt", "gte", "lt", "lte", "between"]
  return field.nullable ? [...base, "empty", "notEmpty"] : base
}
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
/** Strict validation: invalid predicates must never silently broaden a query. */
export function parseTableQuery(
  raw: unknown,
  fields: readonly QueryField[],
  safeStorage = false,
): TableQuery {
  const q = object(raw)
  if (
    q.version !== 1 ||
    typeof q.search !== "string" ||
    q.search.length > 200 ||
    !Array.isArray(q.sorts) ||
    q.sorts.length > 3
  )
    throw new Error("查询格式或数量超限")
  const schema = new Map(fields.map((field) => [field.key, field]))
  let count = 0
  const group = (raw: unknown, depth: number): FilterGroup => {
    const g = object(raw)
    if (
      depth > 3 ||
      !["and", "or"].includes(String(g.logic)) ||
      !Array.isArray(g.children) ||
      g.children.length > 20
    )
      throw new Error("条件组最多 3 层、20 个条件")
    return {
      logic: g.logic as "and" | "or",
      children: g.children.map((raw) => {
        const c = object(raw)
        if ("logic" in c) return group(c, depth + 1)
        if (++count > 20) throw new Error("条件最多 20 个")
        const field = schema.get(String(c.field))
        if (
          !field ||
          (safeStorage && field.sensitive) ||
          !operators(field).includes(c.op as FilterCondition["op"])
        )
          throw new Error("字段或操作符不可用")
        const op = c.op as FilterCondition["op"]
        if (op === "empty" || op === "notEmpty") return { field: field.key, op }
        const scalar = (v: unknown): QueryValue => {
          if (
            field.type === "number" &&
            typeof v === "number" &&
            Number.isFinite(v) &&
            Math.abs(v) <= Number.MAX_SAFE_INTEGER
          )
            return v
          if (field.type === "boolean" && typeof v === "boolean") return v
          if (field.type === "enum" && field.options?.some((option) => option.value === v))
            return v as QueryValue
          if (
            field.type === "date" &&
            typeof v === "string" &&
            /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
            Number.isFinite(Date.parse(v))
          )
            return new Date(v).toISOString()
          if (field.type === "text" && typeof v === "string" && v.length <= 200) return v
          throw new Error(`${field.label}的值不合法`)
        }
        if (op === "in" || op === "between") {
          if (
            !Array.isArray(c.value) ||
            !c.value.length ||
            c.value.length > 50 ||
            (op === "between" && c.value.length !== 2)
          )
            throw new Error("范围值不合法")
          const values = c.value.map(scalar)
          if (op === "between" && values[0] > values[1]) throw new Error("范围起点不能大于终点")
          return { field: field.key, op, value: values }
        }
        return { field: field.key, op, value: scalar(c.value) }
      }),
    }
  }
  const seen = new Set<string>()
  const sorts = q.sorts.map((raw) => {
    const sort = object(raw),
      field = schema.get(String(sort.field))
    if (
      !field ||
      field.sortable === false ||
      typeof sort.desc !== "boolean" ||
      seen.has(field.key)
    )
      throw new Error("排序字段不可用或重复")
    seen.add(field.key)
    return { field: field.key, desc: sort.desc }
  })
  return { version: 1, search: q.search.trim(), filter: group(q.filter, 1), sorts }
}
export function queryUrl(
  params: URLSearchParams,
  prefix: string,
  query: TableQuery,
  fields: readonly QueryField[],
  pagination?: { pageIndex: number; pageSize: number },
) {
  const next = new URLSearchParams(params)
  const safe = parseTableQuery(query, fields, true)
  // Search may contain personal data; callers must opt in separately to sharing search.
  if (safe.search) throw new Error("搜索内容不写入分享链接，请清空搜索后重试")
  next.set(`${prefix}_query`, JSON.stringify(safe))
  if (pagination) {
    next.set(`${prefix}_page`, String(Math.max(0, pagination.pageIndex) + 1))
    next.set(`${prefix}_pageSize`, String(pagination.pageSize))
  }
  if (next.toString().length > 4000) throw new Error("查询链接过长，请简化条件")
  return next
}

export const queryOperatorLabels: Record<FilterCondition["op"], string> = {
  eq: "等于",
  ne: "不等于",
  contains: "包含",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  in: "属于",
  between: "范围",
  empty: "为空",
  notEmpty: "不为空",
}
export function conditionLabel(
  condition: FilterCondition | FilterGroup,
  fields: readonly QueryField[],
): string {
  if ("logic" in condition)
    return `满足${condition.logic === "and" ? "全部" : "任意"}：${condition.children.map((child) => conditionLabel(child, fields)).join("；") || "无条件"}`
  const field = fields.find((field) => field.key === condition.field)
  const display = (value: QueryValue) =>
    field?.options?.find((option) => option.value === value)?.label ??
    (typeof value === "boolean" ? (value ? "是" : "否") : String(value))
  const value =
    "value" in condition
      ? Array.isArray(condition.value)
        ? condition.value.map(display).join("、")
        : display(condition.value)
      : ""
  return `${field?.label ?? condition.field} ${queryOperatorLabels[condition.op]}${value ? ` ${value}` : ""}`
}

export function queryUrlPagination(params: URLSearchParams, prefix: string, policy: TablePageSizePolicy = {}) {
  const page = Number(params.get(`${prefix}_page`))
  const size = Number(params.get(`${prefix}_pageSize`))
  return { pageIndex: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page - 1 : 0, pageSize: params.has(`${prefix}_pageSize`) ? resolveTablePageSize(size, policy) : undefined }
}
