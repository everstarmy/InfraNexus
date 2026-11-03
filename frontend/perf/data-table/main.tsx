import { useState } from "react"
import { createRoot } from "react-dom/client"
import {
  DataTable,
  createSelectColumn,
  type ColumnDef,
  type Table,
} from "../../src/components/data-table/data-table"
import "../../src/index.css"

type Item = { id: string; name: string; children?: Item[] }
const params = new URLSearchParams(location.search)
const count = Number(params.get("rows") ?? 100)
const width = Number(params.get("cols") ?? 20)
const tree = params.has("tree")
const items: Item[] = Array.from({ length: count }, (_, index) => ({
  id: `row-${index}`,
  name: `Item ${String(index).padStart(5, "0")}`,
}))
const data = tree
  ? items.filter((item, index) => {
      if (index % 50 === 0) return true
      const parent = items[index - (index % 50)]
      ;(parent.children ??= []).push(item)
      return false
    })
  : items
let table: Table<Item>
const columns: ColumnDef<Item>[] = Array.from({ length: width }, (_, index) => ({
  id: `c${index}`,
  accessorFn: (row) =>
    index
      ? `${row.name} field ${index}`.repeat(params.has("dynamic") && index === 1 ? 8 : 1)
      : row.name,
  header: `Column ${index}`,
  size: 160,
  ...(index === 0 && params.has("interactive")
    ? {
        cell: ({
          row,
        }: {
          row: import("@tanstack/react-table").Row<
            import("../../src/components/data-table/types").AppTableFeatures,
            Item
          >
        }) => <button onClick={() => row.toggleExpanded()}>{row.original.name}</button>,
      }
    : {}),
  meta: params.has("dynamic") && index === 1 ? { text: { mode: "wrap" } } : undefined,
}))
if (params.has("selection")) columns.unshift(createSelectColumn<Item>())
const finalColumns = params.has("grouped")
  ? [{ id: "group", header: "Grouped columns", columns }]
  : columns
function App() {
  const [shown, setShown] = useState(true)
  const [rows, setRows] = useState(data)
  return (
    <main className="p-4">
      <button
        id="sort"
        onClick={() => table.setSorting((old) => [{ id: "c0", desc: !old[0]?.desc }])}
      >
        排序
      </button>
      <button id="view" onClick={() => table.getColumn("c1")?.toggleVisibility()}>
        切换列视图
      </button>
      <button id="select" onClick={() => table.getRowModel().rows[0]?.toggleSelected()}>
        选择
      </button>
      <button
        id="insert"
        onClick={() => setRows((old) => [{ id: "inserted", name: "New item" }, ...old])}
      >
        插入
      </button>
      <button id="refresh" onClick={() => setRows((old) => old.map((row) => ({ ...row })))}>
        刷新数据
      </button>
      <button id="mount" onClick={() => setShown((value) => !value)}>
        挂载切换
      </button>
      {shown && (
        <DataTable
          columns={finalColumns}
          data={rows}
          getRowId={(row) => row.id}
          virtualization={params.has("virtual") ? {} : undefined}
          layoutControls={
            params.has("interactive") ? { density: true, fullscreen: true } : undefined
          }
          detail={params.has("detail") ? { render: (row) => row.name } : undefined}
          enableColumnPinning={params.has("interactive")}
          initialColumnPinning={{ start: ["c0"], end: [] }}
          onTableInstance={(value) => {
            table = value
          }}
          defaultPageSize={Number(params.get("pageSize") ?? count)}
          pageSizeOptions={[10, 20, 50, 100, count]}
          maxPageSize={count}
          getSubRows={tree ? (row) => row.children : undefined}
          defaultExpanded={true}
          enableColumnResizing
          viewport={{ mode: "max-height", maxHeight: 520, restoreKey: "perf-table" }}
          hideSearch
          hideRefresh
          hideViewOptions
        />
      )}
    </main>
  )
}
createRoot(document.getElementById("root")!).render(<App />)
