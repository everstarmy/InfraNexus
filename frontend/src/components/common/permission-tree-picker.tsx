import * as React from "react"
import { Boxes, MousePointerClick, PanelsTopLeft, Search, Webhook } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { MethodBadge } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { clearNodes, countSelected, indexPermissionTree, invertNodes, nodeState, selectNodes, summarizeSelection, toggleNode } from "@/lib/permission-selection"
import { filterTree } from "@/lib/tree"
import { cn } from "@/lib/utils"
import type { PermissionDTO } from "@/services/roles"

const typeMeta = {
  menu: { label: "菜单", icon: PanelsTopLeft, className: "border-primary/30 bg-primary/10 text-primary" },
  button: { label: "按钮", icon: MousePointerClick, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  api: { label: "接口", icon: Webhook, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
} as const

export function PermissionTreePicker({
  tree,
  value,
  onChange,
}: {
  tree: PermissionDTO[]
  value: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}) {
  const confirm = useConfirm()
  const [query, setQuery] = React.useState("")
  const keyword = query.trim().toLowerCase()
  const visible = React.useMemo(
    () =>
      keyword
        ? filterTree(tree, (n) => n.name.toLowerCase().includes(keyword) || n.code.toLowerCase().includes(keyword) || (n.path ?? "").toLowerCase().includes(keyword))
        : tree,
    [tree, keyword],
  )
  const selectionIndex = React.useMemo(() => indexPermissionTree(visible), [visible])
  const summaries = React.useMemo(() => summarizeSelection(value, selectionIndex), [value, selectionIndex])

  const clearModule = async (module: PermissionDTO) => {
    const count = countSelected(value, module, selectionIndex, summaries).selected
    if (!count) return
    const searchScope = keyword ? "当前筛选结果中的" : `「${module.name}」模块中的`
    const accepted = await confirm({
      tone: "default",
      title: "清空已选权限？",
      description: `将清除${searchScope} ${count} 项已选授权。${keyword ? "未显示的权限不会被修改。" : "保存后这些权限将从角色中移除。"}`,
      confirmText: "清空权限",
    })
    if (accepted) onChange(clearNodes(value, module, selectionIndex))
  }

  const renderNode = (node: PermissionDTO, depth: number): React.ReactNode => {
    const state = nodeState(value, node, selectionIndex, summaries)
    const meta = typeMeta[node.type]
    const Icon = meta.icon
    return (
      <li key={node.id}>
        <label
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 transition-colors hover:bg-muted/60",
            state !== "unchecked" && "bg-primary/[0.03]",
          )}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          <Checkbox
            checked={state === "checked"}
            indeterminate={state === "indeterminate"}
            aria-label={`${node.name}${keyword ? "（当前筛选范围）" : ""}`}
            onCheckedChange={() => onChange(toggleNode(value, node, state !== "checked", selectionIndex))}
            className="data-indeterminate:border-primary data-indeterminate:bg-primary/40"
          />
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">{node.name}</span>
          <Badge variant="outline" className={cn("h-4.5 shrink-0 rounded-md px-1.5 text-[10px]", meta.className)}>
            {meta.label}
          </Badge>
          {node.type === "api" && (
            <span className="ml-auto flex min-w-0 items-center gap-1.5">
              <MethodBadge method={node.method} />
              <code className="truncate font-mono text-[11px] text-muted-foreground">{node.path}</code>
            </span>
          )}
        </label>
        {node.children && node.children.length > 0 && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="space-y-3">
      <InputGroup className="h-8 shadow-none border-input/50 bg-muted/30 focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按名称、编码或接口路径过滤" className="text-xs" />
      </InputGroup>
      {keyword && (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          当前显示匹配结果及其上级节点；勾选、全选、反选和清空只作用于可见结果，隐藏权限保持不变。
        </p>
      )}
      <div className="space-y-3">
        {visible.map((module) => {
          const { selected, total } = countSelected(value, module, selectionIndex, summaries)
          return (
            <section key={module.id} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <Boxes className="size-4 text-primary" />
                <h4 className="text-sm font-semibold">{module.name}</h4>
                <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground tabular-nums ring-1 ring-border">
                  {selected} / {total}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button type="button" variant="ghost" size="xs" aria-label={keyword ? `选中「${module.name}」的匹配结果` : `选中「${module.name}」模块全部权限`} onClick={() => onChange(selectNodes(value, module, selectionIndex))}>
                    {keyword ? "选中结果" : "全选"}
                  </Button>
                  <Button type="button" variant="ghost" size="xs" aria-label={keyword ? `反选「${module.name}」的匹配结果` : `反选「${module.name}」模块权限`} onClick={() => onChange(invertNodes(value, module, selectionIndex))}>
                    {keyword ? "反选结果" : "反选"}
                  </Button>
                  <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" aria-label={keyword ? `清空「${module.name}」的匹配结果` : `清空「${module.name}」模块已选权限`} onClick={() => void clearModule(module)}>
                    {keyword ? "清空结果" : "清空"}
                  </Button>
                </div>
              </header>
              <ul className="p-1.5">{renderNode(module, 0)}</ul>
            </section>
          )
        })}
        {visible.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">没有匹配的权限点</p>}
      </div>
    </div>
  )
}
