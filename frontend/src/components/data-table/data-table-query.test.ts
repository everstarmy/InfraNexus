import { describe, it, expect } from "vitest"
import { emptyQuery, parseTableQuery, queryUrl, type QueryField } from "./data-table-query"
import { sanitizePreferences } from "./data-table-preferences"
import { decodeViews } from "./data-table-views"
import type { ColumnDef } from "./types"
const fields: QueryField[] = [
  { key: "n", label: "数量", type: "number" },
  { key: "email", label: "邮箱", type: "text", sensitive: true },
  { key: "date", label: "时间", type: "date" },
]
describe("M2 query boundary", () => {
  it("rejects unknown fields, operators, excessive conditions and unsafe numbers", () => {
    for (const condition of [
      { field: "password", op: "eq", value: 1 },
      { field: "n", op: "contains", value: "x" },
      { field: "n", op: "eq", value: Infinity },
      { field: "n", op: "between", value: [3, 1] },
    ])
      expect(() =>
        parseTableQuery(
          { ...emptyQuery(), filter: { logic: "and", children: [condition] } },
          fields,
        ),
      ).toThrow()
    expect(() =>
      parseTableQuery(
        {
          ...emptyQuery(),
          filter: {
            logic: "and",
            children: Array.from({ length: 21 }, () => ({ field: "n", op: "eq", value: 1 })),
          },
        },
        fields,
      ),
    ).toThrow()
  })
  it("normalizes date offsets and preserves unrelated URL parameters", () => {
    const query = parseTableQuery(
      {
        ...emptyQuery(),
        filter: {
          logic: "and",
          children: [{ field: "date", op: "eq", value: "2026-10-28T08:00:00+08:00" }],
        },
      },
      fields,
    )
    expect(query.filter.children[0]).toEqual({
      field: "date",
      op: "eq",
      value: "2026-10-28T00:00:00.000Z",
    })
    const url = queryUrl(new URLSearchParams("detail=keep&other_query=x"), "users", query, fields)
    expect(url.get("detail")).toBe("keep")
    expect(url.get("other_query")).toBe("x")
  })
  it("prevents sensitive predicates and free text from entering share URLs", () => {
    expect(() =>
      queryUrl(new URLSearchParams(), "users", { ...emptyQuery(), search: "private" }, fields),
    ).toThrow()
    expect(() =>
      queryUrl(
        new URLSearchParams(),
        "users",
        {
          ...emptyQuery(),
          filter: { logic: "and", children: [{ field: "email", op: "eq", value: "private" }] },
        },
        fields,
      ),
    ).toThrow()
  })
  it("rejects incompatible views and strips unexpected snapshot fields", () => {
    expect(() => decodeViews('{"version":2,"views":[]}', fields)).toThrow()
    const layout = sanitizePreferences(null, [])
    const store = decodeViews(
      JSON.stringify({
        version: 1,
        views: [
          {
            id: "x",
            name: "demo",
            query: emptyQuery(),
            layout,
            pageSize: 20,
            selection: ["secret"],
            page: 10,
          },
        ],
      }),
      fields,
    )
    expect(store.views[0]).not.toHaveProperty("selection")
    expect(store.views[0]).not.toHaveProperty("page")
  })
})
describe("M2 layout migration", () => {
  const columns: ColumnDef<{ a: string; b: string }>[] = [
    { id: "select", enableHiding: false },
    { accessorKey: "a", minSize: 80, maxSize: 200 },
    { accessorKey: "b", meta: { layout: { move: false, pin: false } } },
    { id: "actions" },
  ]
  it("sanitizes removed/locked columns, old density and width bounds", () => {
    const result = sanitizePreferences(
      {
        columnVisibility: { select: false, a: false, b: false, removed: true },
        columnSizing: { a: 999 },
        columnOrder: ["actions", "b", "a", "select"],
        columnPinning: { start: ["b", "a", "removed"], end: ["a"] },
      },
      columns,
      {},
      { start: [], end: [] },
      true,
    )
    expect(result.columnOrder).toEqual(["select", "a", "b", "actions"])
    expect(result.columnVisibility).toEqual({ select: true, a: true, b: false })
    expect(result.columnSizing.a).toBe(200)
    expect(result.density).toBe("standard")
    expect(result.columnPinning).toEqual({ start: ["a"], end: [] })
  })
  it("never moves columns across nested group boundaries", () => {
    const result = sanitizePreferences({ columnOrder: ["b", "a"] }, [
      { id: "first", columns: [{ accessorKey: "a" }] },
      { id: "second", columns: [{ accessorKey: "b" }] },
    ])
    expect(result.columnOrder).toEqual(["a", "b"])
  })
})

it('stores sensitive field ordering without allowing sensitive predicate values', () => {
  const query = { ...emptyQuery(), sorts: [{ field: 'email', desc: false }] }
  expect(parseTableQuery(query, fields, true).sorts).toEqual(query.sorts)
  expect(queryUrl(new URLSearchParams(), 'users', query, fields).get('users_query')).toContain('"email"')
  const view = { id: 'sort-only', name: '排序', query, layout: sanitizePreferences(null, []), pageSize: 10 }
  expect(decodeViews(JSON.stringify({ version: 1, views: [view] }), fields).views[0].query.sorts).toEqual(query.sorts)
  expect(() => parseTableQuery({ ...query, filter: { logic: 'and', children: [{ field: 'email', op: 'eq', value: 'private@example.test' }] } }, fields, true)).toThrow()
})
