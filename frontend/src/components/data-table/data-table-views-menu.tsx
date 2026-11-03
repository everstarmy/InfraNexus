import type { TablePageSizePolicy } from "@/lib/table-page-size"
import { canonicalSnapshot } from "./data-table-view-identity"
import { Bookmark } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useConfirm } from "@/components/common/confirm-dialog"
import {
  decodeViews,
  viewStorageKey,
  type TableViewSnapshot,
  type TableViewStore,
} from "./data-table-views"
import { parseTableQuery, type QueryField } from "./data-table-query"
export function DataTableViewsMenu({
  storageKey,
  snapshot,
  fields,
  apply,
  activeView,
  pageSizePolicy,
}: {
  storageKey: string
  snapshot: TableViewSnapshot
  fields: readonly QueryField[]
  pageSizePolicy?: TablePageSizePolicy
  activeView?: { id: string; snapshot: TableViewSnapshot }
  apply: (snapshot: TableViewSnapshot) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [raw, setRaw] = useState<string | null>(null)
  const [store, setStore] = useState<TableViewStore>({ version: 1, views: [] })
  const [selected, setSelected] = useState<string | undefined>(activeView?.id)
  const [applied, setApplied] = useState(() => activeView ? canonicalSnapshot(activeView.snapshot) : "")
  const identity = canonicalSnapshot(activeView)
  const [previousIdentity, setPreviousIdentity] = useState(identity)
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity)
    setSelected(activeView?.id)
    setApplied(activeView ? canonicalSnapshot(activeView.snapshot) : "")
  }
  const confirm = useConfirm()
  const key = viewStorageKey(storageKey)
  const reload = () => {
    try {
      const raw = localStorage.getItem(key)
      let recovered = false
      const next = decodeViews(raw, fields, pageSizePolicy, () => { recovered = true })
      setStore(next)
      const current = next.views.find(view => view.id === selected)
      if (!name && current) setName(current.name)
      setRaw(raw)
      setError(recovered ? "部分视图的页大小已不再支持，已恢复为当前默认值" : "")
    } catch {
      setError("视图无法读取或已过期；当前表格仍可使用")
    }
  }
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key) setError("其他标签页已修改视图；请重新打开面板后操作")
    }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [key])
  const save = (next: TableViewStore) => {
    try {
      if (localStorage.getItem(key) !== raw)
        throw new Error("其他标签页已修改视图；请重新打开面板后操作")
      const encoded = JSON.stringify(next)
      decodeViews(encoded, fields, pageSizePolicy)
      localStorage.setItem(key, encoded)
      setRaw(encoded)
      setStore(next)
      setError("")
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败")
      return false
    }
  }
  const capture = () => ({ ...snapshot, query: parseTableQuery(snapshot.query, fields, true) })
  const active = store.views.find((view) => view.id === selected)
  return (
    <>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`保存视图${applied && applied !== canonicalSnapshot(snapshot) ? " · 已修改" : ""}`}
        title="本地保存视图"
        onClick={() => {
          reload()
          setOpen(true)
        }}
      >
        <Bookmark />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>本地保存视图</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            仅此浏览器、当前用户可用。保存查询、排序、列布局、密度和页大小；不保存页码与选择。敏感字段不可保存。
          </p>
          <Field>
            <FieldLabel htmlFor="table-view-name">视图名称</FieldLabel>
            <Input
              id="table-view-name"
              maxLength={50}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!name.trim() || store.views.length >= 20}
              onClick={() => {
                try {
                  if (store.views.some((view) => view.name === name.trim()))
                    throw new Error("视图名称已存在")
                  const id = crypto.randomUUID()
                  if (
                    save({
                      ...store,
                      views: [...store.views, { ...capture(), id, name: name.trim() }],
                    })
                  ) {
                    setSelected(id)
                    setApplied(canonicalSnapshot(snapshot))
                  }
                } catch (error) {
                  setError(error instanceof Error ? error.message : "保存失败")
                }
              }}
            >
              另存为新视图
            </Button>
            <Button
              variant="outline"
              disabled={!active}
              onClick={async () => {
                if (
                  !active ||
                  !(await confirm({
                    title: "覆盖保存视图",
                    tone: "default",
                    confirmText: "确认覆盖",
                    description: `使用当前配置覆盖「${active.name}」？`,
                  }))
                )
                  return
                try {
                  if (
                    save({
                      ...store,
                      views: store.views.map((view) =>
                        view.id === active.id
                          ? { ...capture(), id: active.id, name: active.name }
                          : view,
                      ),
                    })
                  )
                    setApplied(canonicalSnapshot(snapshot))
                } catch (error) {
                  setError(error instanceof Error ? error.message : "保存失败")
                }
              }}
            >
              覆盖当前视图
            </Button>
            <Button
              variant="outline"
              disabled={!active || !name.trim()}
              onClick={() => {
                if (!active) return
                if (
                  store.views.some((view) => view.id !== active.id && view.name === name.trim())
                ) {
                  setError("视图名称已存在")
                  return
                }
                save({
                  ...store,
                  views: store.views.map((view) =>
                    view.id === active.id ? { ...view, name: name.trim() } : view,
                  ),
                })
              }}
            >
              重命名当前视图
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {store.views.map((view) => (
              <li key={view.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
                <span className="min-w-0 flex-1 break-words">
                  <span>{view.name}</span>{selected === view.id ? "（当前）" : ""}
                  {store.defaultId === view.id ? "（默认）" : ""}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    apply(view)
                    setSelected(view.id)
                    setName(view.name)
                    setApplied(
                      canonicalSnapshot({
                        query: view.query,
                        layout: view.layout,
                        pageSize: view.pageSize,
                      }),
                    )
                    setOpen(false)
                  }}
                >
                  应用
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    save({ ...store, defaultId: store.defaultId === view.id ? undefined : view.id })
                  }
                >
                  {store.defaultId === view.id ? "取消默认" : "设为默认"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "删除保存视图",
                        description: `删除「${view.name}」？`,
                      })
                    )
                      if (save({
                        ...store,
                        defaultId: store.defaultId === view.id ? undefined : store.defaultId,
                        views: store.views.filter((item) => item.id !== view.id),
                      }) && selected === view.id) { setSelected(undefined); setApplied("") }
                  }}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (
                !(await confirm({
                  title: "重置本表保存视图",
                  description: "删除当前用户此表格的全部本地视图？列布局偏好不受影响。",
                }))
              )
                return
              try {
                localStorage.removeItem(key)
                setSelected(undefined)
                setApplied("")
                reload()
              } catch {
                setError("本地存储不可用，无法重置")
              }
            }}
          >
            重置本表保存视图
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
