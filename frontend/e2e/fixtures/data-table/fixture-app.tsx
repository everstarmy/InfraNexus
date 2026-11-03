import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  DataTable,
  createTextColumn,
  createNumberColumn,
  createDateColumn,
  createBadgeColumn,
  createActionsColumn,
  exportLoadedRowsCSV,
  type Table,
  type DataTablePreset,
} from "../../../src/components/data-table"
import { Button } from "../../../src/components/ui/button"
import { renderFixture } from "./render"
import type { FixtureOptions, TableScenario } from "./data"
import "/src/index.css"
const scenarios = [
  "wide",
  "long-text",
  "tree",
  "virtualized",
  "grouped",
  "error",
  "presets",
] as const
type Scenario = (typeof scenarios)[number]
type DemoRow = { id: string; name: string; amount: number; date: string; status: string }
const demoRows: DemoRow[] = [
  { id: "1", name: "示例成员", amount: 1234, date: "2026-10-01", status: "ok" },
]
function PresetDemo({
  preset,
  updating,
  error,
  onRetry,
}: {
  preset: DataTablePreset
  updating: boolean
  error: boolean
  onRetry: () => void
}) {
  const [empty, setEmpty] = useState(false)
  const [notice, setNotice] = useState("")
  const tableRef = useRef<Table<DemoRow> | null>(null)
  const columns = [
    createTextColumn<DemoRow>({ accessorKey: "name", title: "姓名" }),
    createNumberColumn<DemoRow>({ accessorKey: "amount", title: "数量" }),
    createDateColumn<DemoRow>({ accessorKey: "date", title: "日期" }),
    createBadgeColumn<DemoRow>({
      accessorKey: "status",
      title: "状态",
      options: { ok: { label: "正常" } },
    }),
    createActionsColumn<DemoRow>({
      actions: (row) => [
        { key: "inspect", label: "查看", onSelect: () => setNotice(`已查看 ${row.name}`) },
      ],
    }),
  ]
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setEmpty((v) => !v)}>
        切换空数据
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          if (tableRef.current) exportLoadedRowsCSV(tableRef.current, { filename: "gallery.csv" })
        }}
      >
        导出当前页
      </Button>
      <span role="status">{notice}</span>
      <DataTable
        onTableInstance={(table) => {
          tableRef.current = table
        }}
        preset={preset}
        columns={columns}
        data={empty ? [] : demoRows}
        getRowId={(r) => r.id}
        isRefreshing={updating}
        error={error ? new Error("模拟查询失败") : undefined}
        onRetry={onRetry}
      />
    </>
  )
}
function LegacyScene({
  scenario,
  updating,
  error,
  onRetry,
}: {
  scenario: Scenario
  updating: boolean
  error: boolean
  onRetry: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const options: FixtureOptions = {
      scenario:
        scenario === "grouped" || scenario === "virtualized" ? "many" : (scenario as TableScenario),
      controls: true,
      viewport: { mode: "max-height", maxHeight: "55svh" },
      refreshing: updating,
      tableError: error,
      onRetry,
    }
    if (scenario === "wide") Object.assign(options, { pinned: true, rowCount: 120 })
    if (scenario === "long-text") options.text = { mode: "clamp", lines: 2 }
    if (scenario === "grouped") options.details = true
    if (scenario === "virtualized")
      Object.assign(options, {
        rowCount: 10000,
        pageSize: 10000,
        pageSizeOptions: [10000],
        maxPageSize: 10000,
        virtualized: true,
      })
    const unmount = renderFixture(host.current!, options)
    return () => {
      queueMicrotask(unmount)
    }
  }, [scenario, updating, error, onRetry])
  return <div ref={host} />
}
function Gallery() {
  const [scenario, setScenario] = useState<Scenario>("wide")
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr")
  const [updating, setUpdating] = useState(false),
    [error, setError] = useState(false)
  const [preset, setPreset] = useState<DataTablePreset>("standard")
  // Stable retry callback avoids remounting the fixture for unrelated renders.
  const retry = useRef(() => setError(false)).current
  return (
    <div dir={direction} className="flex min-w-0 flex-col gap-3">
      <nav aria-label="表格场景" className="flex flex-wrap gap-2">
        {scenarios.map((item) => (
          <Button
            key={item}
            variant={scenario === item ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setScenario(item)
              setError(item === "error")
            }}
          >
            {item}
          </Button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDirection((d) => (d === "ltr" ? "rtl" : "ltr"))}
        >
          {direction.toUpperCase()}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={updating}
          onClick={() => setUpdating((v) => !v)}
        >
          模拟刷新
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={error}
          onClick={() => setError((v) => !v)}
        >
          模拟错误
        </Button>
        {scenario === "presets" && (
          <label>
            预设{" "}
            <select
              aria-label="能力预设"
              value={preset}
              onChange={(e) => setPreset(e.target.value as DataTablePreset)}
            >
              {["simple", "standard", "advanced"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {scenario === "presets" || scenario === "error" ? (
        <PresetDemo key={scenario} preset={preset} updating={updating} error={error} onRetry={retry} />
      ) : (
        <LegacyScene
          key={`${scenario}:${updating}:${error}`}
          scenario={scenario}
          updating={updating}
          error={error}
          onRetry={retry}
        />
      )}
    </div>
  )
}
const params = new URLSearchParams(location.search)
if (params.get("gallery") === "1")
  createRoot(document.getElementById("fixture")!).render(<Gallery />)
else
  renderFixture(document.getElementById("fixture")!, {
    scenario: (params.get("scenario") as TableScenario | null) ?? "wide",
    rowCount: 120,
    pageSize: 50,
    pinned: true,
    controls: true,
    preference: true,
    interactive: true,
    viewport: { mode: "max-height", maxHeight: "55svh", mobileContent: true },
  })
