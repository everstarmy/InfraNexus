import * as React from "react"
import {
  Boxes,
  Building2,
  CheckCheck,
  Layers,
  LayoutDashboard,
  MousePointerClick,
  PanelsTopLeft,
  Plug,
  Search,
  ShieldCheck,
  Webhook,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { MethodBadge } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import {
  clearNodes,
  countSelected,
  indexPermissionTree,
  invertNodes,
  nodeState,
  selectNodes,
  summarizeSelection,
  toggleNode,
} from "@/lib/permission-selection"
import { filterTree } from "@/lib/tree"
import { cn } from "@/lib/utils"
import type { PermissionDTO } from "@/services/roles"

const ALL_KEY = "__ALL__"
const SELECTED_KEY = "__SELECTED__"

const typeMeta = {
  menu: { label: "菜单", icon: PanelsTopLeft, className: "border-primary/30 bg-primary/10 text-primary" },
  button: { label: "按钮", icon: MousePointerClick, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  api: { label: "接口", icon: Webhook, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
} as const

function getModuleIcon(code: string) {
  switch (code) {
    case "dashboard":
      return LayoutDashboard
    case "org":
    case "users":
    case "departments":
      return Building2
    case "access":
    case "roles":
    case "permissions":
      return ShieldCheck
    case "integration":
    case "ldap":
      return Plug
    default:
      return Boxes
  }
}

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
  const [activeCategory, setActiveCategory] = React.useState<string>(ALL_KEY)

  // 全量树的索引与汇总（用于计算每个模块真实的已选/总计）
  const fullSelectionIndex = React.useMemo(() => indexPermissionTree(tree), [tree])
  const fullSummaries = React.useMemo(() => summarizeSelection(value, fullSelectionIndex), [value, fullSelectionIndex])

  // 默认激活第一个大模块，若未加载则保留 ALL_KEY
  React.useEffect(() => {
    if (tree.length > 0 && activeCategory === ALL_KEY) {
      setActiveCategory(tree[0].id)
    }
  }, [tree])

  // 当外部 tree 变动时，若当前选中的分类已不存在，安全回退至第一个模块
  React.useEffect(() => {
    if (activeCategory !== ALL_KEY && activeCategory !== SELECTED_KEY) {
      if (tree.length > 0 && !tree.some((m) => m.id === activeCategory)) {
        setActiveCategory(tree[0].id)
      }
    }
  }, [tree, activeCategory])

  const keyword = query.trim().toLowerCase()
  const visible = React.useMemo(
    () =>
      keyword
        ? filterTree(tree, (n) =>
            n.name.toLowerCase().includes(keyword) ||
            n.code.toLowerCase().includes(keyword) ||
            (n.path ?? "").toLowerCase().includes(keyword),
          )
        : tree,
    [tree, keyword],
  )
  const selectionIndex = React.useMemo(() => indexPermissionTree(visible), [visible])
  const summaries = React.useMemo(() => summarizeSelection(value, selectionIndex), [value, selectionIndex])

  // 仅看已选权限树
  const selectedOnlyTree = React.useMemo(() => {
    return filterTree(tree, (n) => value.has(n.id))
  }, [tree, value])

  const clearModule = async (module: PermissionDTO) => {
    const count = countSelected(value, module, selectionIndex, summaries).selected
    if (!count) return
    const searchScope = keyword ? "当前筛选结果中的" : `「${module.name}」模块中的`
    const accepted = await confirm({
      tone: "default",
      title: "清空已选权限？",
      description: `将清除${searchScope} ${count} 项已选授权。${
        keyword ? "未显示的权限不会被修改。" : "保存后这些权限将从角色中移除。"
      }`,
      confirmText: "清空权限",
    })
    if (accepted) onChange(clearNodes(value, module, selectionIndex))
  }

  const clearAllSelected = async () => {
    if (!value.size) return
    const accepted = await confirm({
      tone: "default",
      title: "清空全部已选权限？",
      description: `将从角色中移除当前已勾选的全部 ${value.size} 项权限。保存后这些授权将立即失效。`,
      confirmText: "全部清空",
    })
    if (accepted) onChange(new Set())
  }

  // 构建分类选项列表
  const categories = React.useMemo(() => {
    const globalCount = countSelected(value, { id: "root", children: tree }, fullSelectionIndex, fullSummaries)
    const items: Array<{
      id: string
      name: string
      icon: React.ComponentType<{ className?: string }>
      selected: number
      total: number
      hasSelected: boolean
      isSpecial?: boolean
    }> = [
      {
        id: ALL_KEY,
        name: "全部模块",
        icon: Layers,
        selected: globalCount.selected,
        total: globalCount.total,
        hasSelected: globalCount.selected > 0,
      },
    ]

    for (const mod of tree) {
      const counts = countSelected(value, mod, fullSelectionIndex, fullSummaries)
      items.push({
        id: mod.id,
        name: mod.name,
        icon: getModuleIcon(mod.code),
        selected: counts.selected,
        total: counts.total,
        hasSelected: counts.selected > 0,
      })
    }

    items.push({
      id: SELECTED_KEY,
      name: "仅看已选",
      icon: CheckCheck,
      selected: value.size,
      total: globalCount.total,
      hasSelected: value.size > 0,
    })

    return items
  }, [tree, value, fullSelectionIndex, fullSummaries])

  // 当前主区域展示的目标模块列表
  const targetModules = React.useMemo(() => {
    if (keyword) {
      // 搜索状态下无视分类，平铺所有匹配项
      return visible
    }
    if (activeCategory === ALL_KEY) {
      return visible
    }
    if (activeCategory === SELECTED_KEY) {
      return selectedOnlyTree
    }
    const single = visible.find((m) => m.id === activeCategory)
    return single ? [single] : []
  }, [keyword, activeCategory, visible, selectedOnlyTree])

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
        {node.children && node.children.length > 0 && (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  // 渲染单个模块的 Header 控制栏
  const renderModuleHeader = (module: PermissionDTO, isSingleView: boolean) => {
    const { selected, total } = countSelected(value, module, selectionIndex, summaries)
    const ModuleIcon = getModuleIcon(module.code)
    return (
      <header
        className={cn(
          "flex flex-wrap items-center gap-2",
          isSingleView ? "mb-3 border-b pb-2.5" : "border-b bg-muted/40 px-3 py-2",
        )}
      >
        <ModuleIcon className="size-4 text-primary" />
        <h4 className="text-sm font-semibold">{module.name}</h4>
        <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground tabular-nums ring-1 ring-border">
          {selected} / {total}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={keyword ? `选中「${module.name}」的匹配结果` : `选中「${module.name}」全部权限`}
            onClick={() => onChange(selectNodes(value, module, selectionIndex))}
          >
            {keyword ? "选中结果" : "全选"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={keyword ? `反选「${module.name}」的匹配结果` : `反选「${module.name}」权限`}
            onClick={() => onChange(invertNodes(value, module, selectionIndex))}
          >
            {keyword ? "反选结果" : "反选"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            aria-label={keyword ? `清空「${module.name}」的匹配结果` : `清空「${module.name}」已选权限`}
            onClick={() => void clearModule(module)}
          >
            {keyword ? "清空结果" : "清空"}
          </Button>
        </div>
      </header>
    )
  }

  const isSingleModuleView = !keyword && activeCategory !== ALL_KEY && activeCategory !== SELECTED_KEY
  const isSelectedOnlyView = !keyword && activeCategory === SELECTED_KEY

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2.5">
      {/* 顶部搜索框 */}
      <InputGroup className="h-8.5 shrink-0 shadow-none border-input/60 bg-muted/30 focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        <InputGroupAddon>
          <Search className="size-3.5 text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索权限名称、编码或接口路径（跨模块全局匹配）..."
          className="text-xs"
        />
        {query && (
          <InputGroupAddon>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="清空搜索"
            >
              <X className="size-3.5" />
            </button>
          </InputGroupAddon>
        )}
      </InputGroup>

      {/* 搜索提示 */}
      {keyword && (
        <div className="shrink-0 rounded-lg border border-primary/20 bg-primary/[0.03] px-3 py-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
          全局搜索已启用：展示所有匹配结果及其上级菜单；勾选、全选与清空仅作用于可见结果。
        </div>
      )}

      {/* 主体分栏容器：大屏左右两栏，移动端顶部分类横滑 + 下方整宽树 */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs sm:flex-row">
        {/* 左侧 (大屏) / 顶部 (移动端) 分类导航 */}
        <nav
          aria-label="权限模块分类"
          className={cn(
            "flex shrink-0 gap-1 border-b bg-muted/20 p-1.5",
            "overflow-x-auto sm:w-44 sm:flex-col sm:border-b-0 sm:border-r sm:overflow-y-auto sm:p-2",
          )}
        >
          {categories.map((cat) => {
            const Icon = cat.icon
            const isActive = !keyword && activeCategory === cat.id
            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id)
                  if (query) setQuery("")
                }}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  "sm:w-full sm:justify-between sm:px-2.5 sm:py-2",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  cat.isSpecial && !isActive && "text-foreground",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={cn("size-3.5 shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                  <span className="truncate">{cat.name}</span>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : cat.hasSelected
                        ? "bg-primary/10 text-primary font-semibold"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {cat.id === SELECTED_KEY ? cat.selected : `${cat.selected}/${cat.total}`}
                </span>
              </button>
            )
          })}
        </nav>

        {/* 右侧主内容区：单模块或全部模块滚动展示 */}
        <div className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4">
          {/* 「仅看已选」专属视图 */}
          {isSelectedOnlyView ? (
            value.size === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <CheckCheck className="mb-3 size-10 stroke-1 text-muted-foreground/30" />
                <p className="text-sm font-medium">当前角色尚未勾选任何权限</p>
                <p className="mt-1 text-xs text-muted-foreground">可点击分类导航中的具体模块逐项授权</p>
              </div>
            ) : (
              <div className="space-y-4">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCheck className="size-4 text-primary" />
                    <h4 className="text-sm font-semibold">已授权清单</h4>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary tabular-nums">
                      已选 {value.size} 项
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void clearAllSelected()}
                  >
                    全部清空
                  </Button>
                </header>
                <div className="space-y-3">
                  {selectedOnlyTree.map((mod) => (
                    <section key={mod.id} className="overflow-hidden rounded-xl border bg-card">
                      {renderModuleHeader(mod, false)}
                      <ul className="p-1.5">{renderNode(mod, 0)}</ul>
                    </section>
                  ))}
                </div>
              </div>
            )
          ) : isSingleModuleView ? (
            /* 单模块展示视图 */
            targetModules.length > 0 ? (
              <div className="space-y-2">
                {renderModuleHeader(targetModules[0], true)}
                <ul className="p-0.5">{renderNode(targetModules[0], 0)}</ul>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-muted-foreground">该模块暂无权限数据</div>
            )
          ) : (
            /* 全部模块视图 或 搜索结果多模块平铺视图 */
            <div className="space-y-3">
              {targetModules.map((module) => (
                <section key={module.id} className="overflow-hidden rounded-xl border bg-card">
                  {renderModuleHeader(module, false)}
                  <ul className="p-1.5">{renderNode(module, 0)}</ul>
                </section>
              ))}
              {targetModules.length === 0 && (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  {keyword ? "没有匹配的权限点" : "暂无权限数据"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
