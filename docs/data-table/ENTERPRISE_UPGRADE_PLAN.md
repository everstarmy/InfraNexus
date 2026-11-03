# DataTable 企业级开箱即用升级方案（Codex 实施规范）

## 0. 背景与授权边界

用户已明确授权实施除 **#9 国际化文案抽离（i18n）** 之外的 **14 项企业级 DataTable 升级项（#1–#8、#10–#15）**。本方案面向代码执行智能体（Codex），提供可直接按批次落地的接口定义、文件边界、不变量约束与验收命令。

### 0.1 范围矩阵（14 项纳入 / 1 项排除）

| 编号 | 模块 | 升级项 | 状态 | 目标文件 |
| --- | --- | --- | --- | --- |
| #1 | 接入人体工学 | 服务端表格状态聚合 Hook（`useServerTable`） | 纳入 | `frontend/src/components/data-table/use-server-table.ts` |
| #2 | 接入人体工学 | 标准化列定义工厂（`createTextColumn` / `createNumberColumn` / `createDateColumn` / `createBadgeColumn` / `createActionsColumn`） | 纳入 | `frontend/src/components/data-table/data-table-columns.tsx` |
| #3 | 接入人体工学 | 统一行操作列组件（`DataTableRowActions`） | 纳入 | `frontend/src/components/data-table/data-table-row-actions.tsx` |
| #4 | 接入人体工学 | 特性预设模式（`preset?: "simple" \| "standard" \| "advanced"`） | 纳入 | `frontend/src/components/data-table/data-table.tsx`、`types.ts` |
| #5 | 质量与几何回归 | 参数化几何与布局回归矩阵（单测 + E2E） | 纳入 | `frontend/src/components/data-table/data-table-geometry.test.ts`、`frontend/e2e/data-table-layout.spec.ts` |
| #6 | 质量与几何回归 | E2E 异步时序确定性改造（`expect.poll` 替代脆弱等待） | 纳入 | `frontend/e2e/*.spec.ts` |
| #7 | 开发者体验 | 交互式场景画廊（Scenario Gallery） | 纳入 | `frontend/e2e/fixtures/data-table/fixture-app.tsx` |
| #8 | 无障碍与键盘 | ARIA 标签可读性与键盘焦点增强 | 纳入 | `frontend/src/components/data-table/data-table.tsx`、`data-table-column-header.tsx` |
| #9 | 国际化 | ~~文案字典抽离（`messages?: Partial<DataTableMessages>`）~~ | **排除（不做）** | — |
| #10 | 状态闭环 | 内置可选错误态与陈旧数据错误横幅（`error` / `onRetry`） | 纳入 | `frontend/src/components/data-table/data-table.tsx`、`types.ts` |
| #11 | 状态闭环 | 后台刷新与翻页顶部微进度条反馈 | 纳入 | `frontend/src/components/data-table/data-table.tsx` |
| #12 | 元数据消费 | 剪贴板与当前页 CSV/TSV 导出消费 `ColumnMeta.export` | 纳入 | `frontend/src/components/data-table/data-table-clipboard.ts` |
| #13 | 架构可维护性 | 拆解 `data-table.tsx`（提取几何计算纯函数与列偏好 Hook） | 纳入 | `frontend/src/components/data-table/data-table-geometry.ts`、`use-column-preferences.ts` |
| #14 | 文档体系 | 重组 `README.md` 为分层递进手册 | 纳入 | `frontend/src/components/data-table/README.md` |
| #15 | 契约清晰度 | 标注 `ColumnMeta` 中实验性/仅元数据字段的 JSDoc 边界 | 纳入 | `frontend/src/components/data-table/types.ts` |

### 0.1.1 几何兼容性裁决

用户确认保留当前已验证实现，以下约束优先于本文后续原始草案中冲突的描述：
- `sizedLayout` 保留调宽、普通固定、详情、虚拟化、`meta.text` 触发条件；单独 `stickyActionColumn` 不触发。
- 窄屏按实际固定预算保留辅助列，预算为容器宽度减去 160–240px 的滚动数据空间；不整体清空左固定。
- 单 `growColumn` 保留首个非固定、非固定尺寸、具有访问器的数据列，不改成最后一列或固定列回退。
- 仓库实际使用 `loading`、`detail`、`virtualization`、`rowClassName`、`selectionScopeKey` 命名，文档中的其他草案别名不新增为重复 API。
- 当前 `loadedRowsTSV(rows)` 矩阵 API 必须兼容；新增 table 重载，不替换旧签名。
- 当前场景入口为 `/e2e/fixtures/data-table/index.html`；画廊在此基础上实现，并提供计划中的预览路径。

### 0.2 全局红线与架构不变量（Codex 必须严格遵守）

1. **禁止修改原子 UI 组件**：`frontend/src/components/ui/` 下的文件禁止修改（遵循 `AGENTS.md`）。
2. **禁止使用原生弹窗**：禁止 `window.confirm` / `window.alert`；危险操作使用 `useConfirm()`，反馈使用 `notify`。
3. **禁止新增后端接口或修改后端代码**：本次升级严格限定在 `frontend/` 与 `docs/data-table/`。
4. **保持已修复的固定列与几何不变量（不可回退）**：
   - **视觉列顺序**：计算固定列偏移与渲染顺序时，必须基于 `[...table.getStartVisibleLeafColumns(), ...table.getCenterVisibleLeafColumns(), ...table.getEndVisibleLeafColumns()]`，**严禁**回退为未按固定区重排的 `table.getVisibleLeafColumns()`。
   - **辅助列顺序**：`enableRowSelection` 与 `renderDetail` 同时开启时，`columnOrder` 必须保证 `"select"` 在 `"__detail"` 之前（`select: 42px` 在最左，`__detail: 36px` 紧随其后且左偏移为 `42px`）。
   - **`sizedLayout` 触发条件**：保留当前 `enableColumnResizing || enableColumnPinning || detail || virtualization || meta.text` 的触发规则启用 `sizedLayout`（`table-layout: fixed`）；**严禁**将 `stickyActionColumn` 单独作为 `sizedLayout` 的触发条件（否则 `/permissions` 等仅右侧固定操作列的普通表格会产生横向滚动条）。
   - **单 `growColumn` 宽度补偿算法**：`sizedLayout` 下当各列像素总和小于容器宽度时，**只允许将剩余宽度分配给单个 `growColumn`**（`width: calc(100% - ${otherWidth}px)`，表体 `<Table>` 使用 `w-full`），并且 `sizedLayout` 下的 `TableHead` 与 `TableCell` 必须保留 `overflow-hidden`。**严禁**改为多列按比例 `calc(share * 100% - offset)` 分配（Chromium 在 `table-layout: fixed` 且总宽超视口时会压缩左侧 `42px` 的 `select` 列至 `36px`，导致固定列遮挡错位）。
   - **滚动边缘阴影**：左右纵向滚动阴影仅在 `scrollState.canScrollLeft` / `scrollState.canScrollRight` 为 `true` 时渲染，未滚动到中间态时透明度为 `0`。

---

## 批次 1：核心模块化拆解与几何回归矩阵（#13, #5, #6）

> **目标**：先把 `data-table.tsx` 中的列宽/固定列几何纯函数与列偏好持久化 Hook 抽离出来，使得固定列偏移、窄屏预算降级和单 `growColumn` 宽度算法无需启动浏览器即可通过 Vitest 快速覆盖参数化矩阵，同时消除 E2E 中的脆弱等待。

### 1.1 提取几何与固定列计算模块（#13-A）

- **新增文件**：`frontend/src/components/data-table/data-table-geometry.ts`
- **职责**：将 `data-table.tsx` 中的固定列规范化、窄屏固定列预算降级、列宽与 `growColumn` 计算提取为无副作用纯函数（并保留 `normalizeColumnPinning` 从 `data-table.tsx` 及 `index.ts` 重新导出，确保现有单元测试 `data-table-pinning.test.ts` 零破坏）。
- **核心导出签名**：

```ts
import type { ColumnPinningState } from "@tanstack/react-table"

export interface NormalizePinningOptions {
  columnIds: string[]
  stickyActionColumn?: boolean
  enableColumnPinning?: boolean
  narrowViewport?: boolean
}

export function normalizeColumnPinning(
  pinning: ColumnPinningState,
  options: NormalizePinningOptions
): ColumnPinningState

export interface GeometryColumnInput {
  id: string
  size: number
  minSize?: number
  maxSize?: number
  enableResizing?: boolean
  isActionColumn?: boolean
}

export interface ComputeTableGeometryInput {
  /** 已按 [start, center, end] 排列的可见叶子列 */
  columns: GeometryColumnInput[]
  pinning: ColumnPinningState
  sizedLayout: boolean
  containerWidth: number
  narrowPinnedColumns: boolean
}

export interface ComputedColumnGeometry {
  width: number
  renderWidth: number | string
  isGrowColumn: boolean
  pinPosition: "start" | "end" | false
  startOffset?: number
  endOffset?: number
  isLastStartPinned: boolean
  isFirstEndPinned: boolean
}

export interface TableGeometryResult {
  effectivePinning: ColumnPinningState
  totalWidth: number
  growColumnId?: string
  otherWidth: number
  columnsById: Record<string, ComputedColumnGeometry>
}

export function computeTableGeometry(
  input: ComputeTableGeometryInput
): TableGeometryResult
```

- **实现要求**：
  1. `effectivePinning` 规则与现有 `data-table.tsx` 完全一致：
     - `narrowPinnedColumns === true` 时按容器实际预算筛选固定列；辅助列优先，保留 160–240px 滚动数据空间，不整体清空左固定。窄容器即使未开启高级列管理也应用预算。
     - `start` 与 `end` 中的列按传入的 `columns`（或 `columnOrder`）视觉顺序稳定排序。
  2. `growColumnId` 选择规则保持不变：
     - 仅在 `sizedLayout === true` 时选择；
     - 选择首个非固定、非固定尺寸、具有访问器的数据列；
     - 若没有符合条件的数据列，不设置 growColumn，保持基准宽度。
  3. `renderWidth` 规则：
     - 若 `sizedLayout && id === growColumnId`，返回 `` `calc(100% - ${otherWidth}px)` ``；
     - 否则返回像素数值 `width`。
  4. `startOffset` / `endOffset`：
     - 按 `effectivePinning.start` 从左到右累加 `width`；
     - 按 `effectivePinning.end` 从右到左累加 `width`；
     - 精确标记 `isLastStartPinned`（最后一个左固定列）与 `isFirstEndPinned`（第一个右固定列）。

### 1.2 提取列偏好持久化 Hook（#13-B）

- **新增文件**：`frontend/src/components/data-table/use-column-preferences.ts`
- **职责**：将 `data-table.tsx` 中围绕 `preferenceKey` / `preferenceVersion` 的 `localStorage` 读写、合并外部 `columnVisibility` / `columnOrder` / `columnPinning` / `columnSizing` 以及 `resetColumnPreferences` 逻辑封装为独立 Hook，使 `data-table.tsx` 减少约 150 行状态样板。

### 1.3 参数化几何回归矩阵（#5）

- **新增单测文件**：`frontend/src/components/data-table/data-table-geometry.test.ts`
- **测试矩阵要求**：
  使用 `describe.each` 覆盖以下组合：
  - `hasSelect`: `[false, true]`
  - `hasDetail`: `[false, true]`
  - `pinStart`: `[[], ["username"], ["select", "__detail", "username"]]`
  - `pinEnd`: `[[], ["actions"], ["status", "actions"]]`
  - `sizedLayout`: `[false, true]`
  - `viewportWidth`: `[390, 768, 1280]`
- **核心断言**：
  1. 当 `hasSelect && hasDetail` 且 `username` 取消左固定（仅 `select`、`__detail` 左固定）时，`select.startOffset === 0`（宽 `42`），`__detail.startOffset === 42`（宽 `36`），`__detail.isLastStartPinned === true`，绝不出现 `select` 与 `__detail` 重叠或夹杂未固定列。
  2. 当仅启用 `stickyActionColumn`（`enableColumnResizing=false, enableColumnPinning=false`）时，`sizedLayout === false`，不触发固定总宽撑破容器。
  3. 当 `sizedLayout === true` 且 `totalWidth < containerWidth`（如 `totalWidth = 860, containerWidth = 1280`）时，恰有 1 个 `growColumn` 获得 `calc(100% - otherWidth px)`，其余固定列像素宽度不变。
  4. 当 `viewportWidth === 390`（`narrowPinnedColumns = true`）时，保留固定尺寸辅助列，过宽业务固定列按预算降级；595px 时验证用户列在可用空间允许时保留。
- **补充 E2E 断言**：在 `frontend/e2e/data-table-layout.spec.ts` 中增加用例，验证在 `select + __detail` 开启且 `username` 取消固定后横向右滚 `120px` 时，`__detail` 单元格的 `boundingBox().x` 严格等于 `select` 单元格的 `boundingBox().x + boundingBox().width`（允许 `±1px` 亚像素误差），且首个可见非固定列不会从 `select` 与 `__detail` 之间漏出。

### 1.4 E2E 时序确定性改造（#6）

- **目标文件**：`frontend/e2e/data-table-layout.spec.ts`、`frontend/e2e/table-layout-pagination.spec.ts`、`frontend/e2e/users-Sorting-url.spec.ts`
- **整改要求**：
  1. 排查所有固定等待或依赖单次立即可见的滚动/测量断言，统一使用 `await expect.poll(...)` 等待布局稳定（例如 `scrollWidth`、`clientWidth`、`getBoundingClientRect()`、`scrollLeft`）。
  2. 对涉及 `ResizeObserver` 或字体加载后溢出检测的断言，统一通过 `expect.poll` 检查 DOM 属性或几何尺寸。

---

## 批次 2：开箱即用开发体验 — 预设、列助手、行操作组件、服务端 Hook（#4, #2, #3, #1）

> **目标**：把业务页面接入一个完整服务端表格所需的样板代码压缩 60% 以上，同时保持 100% 向后兼容。

### 2.1 特性预设属性 `preset`（#4）

- **修改文件**：
  - `frontend/src/components/data-table/types.ts`
  - `frontend/src/components/data-table/data-table.tsx`
- **类型定义**：

```ts
export type DataTablePreset = "simple" | "standard" | "advanced"
```

在 `DataTableProps<TData, TValue>` 中新增：

```ts
/**
 * 表格能力预设：
 * - "simple": 轻量静态/小表（无列宽拖拽、无自由列固定、无密度/全屏控制，保留 stickyActionColumn=true）
 * - "standard": 标准业务表（开启 stickyActionColumn、enableColumnResizing、layoutControls）
 * - "advanced": 高级工作台表（开启 stickyActionColumn、enableColumnResizing、enableColumnPinning、layoutControls）
 *
 * 注意：显式传入的同名 prop 优先级始终高于 preset 默认值；未传 preset 时完全保持现有默认值，不改变既有页面行为。
 */
preset?: DataTablePreset
```

- **预设映射表（仅当对应 prop 为 `undefined` 时回填）**：

| 属性 | 未传 `preset`（现有默认） | `preset="simple"` | `preset="standard"` | `preset="advanced"` |
| --- | --- | --- | --- | --- |
| `stickyActionColumn` | `false` | `true` | `true` | `true` |
| `enableColumnResizing` | `false` | `false` | `true` | `true` |
| `enableColumnPinning` | `false` | `false` | `false` | `true` |
| `layoutControls` | `false` | `false` | `true` | `true` |

### 2.2 标准化列定义工厂 `data-table-columns.tsx`（#2）

- **新增文件**：`frontend/src/components/data-table/data-table-columns.tsx`（并在 `index.ts` 导出）
- **职责**：提供强类型、内置对齐、空值占位（`—`）、`tabular-nums`、自动列宽测量文本提取（`meta.autoSizeText`）与 `DataTableColumnHeader` 封装的列定义助手。
- **核心 API 与签名**：

```tsx
import type { ColumnDef } from "@tanstack/react-table"
import type { ReactNode } from "react"
import type { ColumnMeta } from "./types"

export interface BaseColumnHelperOptions<TData> {
  id?: string
  title: string
  size?: number
  minSize?: number
  maxSize?: number
  enableSorting?: boolean
  enableHiding?: boolean
  enableResizing?: boolean
  headerClassName?: string
  cellClassName?: string | ((row: TData, value: unknown) => string | undefined)
  meta?: Omit<ColumnMeta<TData, unknown>, "headerClassName" | "cellClassName">
}

/** 1. 文本列助手（支持单行/多行截断 DataTableText、副标题、空值占位 "—"） */
export interface TextColumnOptions<TData> extends BaseColumnHelperOptions<TData> {
  accessorKey?: keyof TData & string
  accessorFn?: (row: TData) => string | null | undefined
  maxLines?: 1 | 2 | 3
  monospace?: boolean
  copyable?: boolean
  emptyText?: string
  renderSecondary?: (row: TData) => ReactNode
}
export function createTextColumn<TData>(options: TextColumnOptions<TData>): ColumnDef<TData, unknown>

/** 2. 数值列助手（默认右对齐 text-right、tabular-nums、千分位或自定义格式化） */
export interface NumberColumnOptions<TData> extends BaseColumnHelperOptions<TData> {
  accessorKey?: keyof TData & string
  accessorFn?: (row: TData) => number | null | undefined
  format?: (value: number, row: TData) => ReactNode
  unit?: string
  align?: "left" | "right" | "center" // 默认 "right"
  emptyText?: string
}
export function createNumberColumn<TData>(options: NumberColumnOptions<TData>): ColumnDef<TData, unknown>

/** 3. 日期时间列助手（默认 tabular-nums、text-muted-foreground、支持相对时间或标准格式化） */
export interface DateColumnOptions<TData> extends BaseColumnHelperOptions<TData> {
  accessorKey?: keyof TData & string
  accessorFn?: (row: TData) => string | Date | null | undefined
  mode?: "datetime" | "date" | "relative" // 默认 "datetime"
  format?: (value: string | Date, row: TData) => ReactNode
  emptyText?: string
}
export function createDateColumn<TData>(options: DateColumnOptions<TData>): ColumnDef<TData, unknown>

/** 4. 状态/枚举徽章列助手（自动关联 meta.autoSizeText 與导出 label） */
export interface BadgeOption {
  label: string
  variant?: "default" | "secondary" | "destructive" | "outline"
  className?: string
  icon?: ReactNode
}
export interface BadgeColumnOptions<TData, TValue extends string | number = string>
  extends BaseColumnHelperOptions<TData> {
  accessorKey?: keyof TData & string
  accessorFn?: (row: TData) => TValue | null | undefined
  options: Record<string, BadgeOption>
  emptyText?: string
}
export function createBadgeColumn<TData, TValue extends string | number = string>(
  options: BadgeColumnOptions<TData, TValue>
): ColumnDef<TData, unknown>

/** 5. 操作列助手（默认 id="actions"、enableSorting=false、enableHiding=false、enableResizing=false、meta.export.enabled=false） */
export interface ActionsColumnOptions<TData> {
  id?: string
  title?: string // 默认为空或 sr-only "操作"
  size?: number  // 默认 56
  actions?: (row: TData) => RowActionItem<TData>[]
  cell?: (row: TData) => ReactNode
}
export function createActionsColumn<TData>(options: ActionsColumnOptions<TData>): ColumnDef<TData, unknown>
```

### 2.3 统一行操作组件 `DataTableRowActions`（#3）

- **新增文件**：`frontend/src/components/data-table/data-table-row-actions.tsx`（并在 `index.ts` 导出）
- **职责**：统一收拢 `users`、`roles`、`permissions` 页面中重复编写的 `DropdownMenu` + `MoreHorizontal` + 阻止行点击冒泡（`e.stopPropagation()`）+ 权限隐藏（`hidden`）+ 禁用原因提示 + 危险操作分隔线。
- **核心类型与组件签名**：

```tsx
import type { ReactNode } from "react"

export interface RowActionItem<TData> {
  key: string
  label: string
  icon?: ReactNode
  onSelect: (row: TData) => void
  /** 为 true 时不渲染该操作项（可配合 usePermission().can("...") 使用） */
  hidden?: boolean
  disabled?: boolean
  /** 危险操作（如删除/吊销），自动置于菜单底部分隔线之后并使用 destructive 样式 */
  destructive?: boolean
}

export interface DataTableRowActionsProps<TData> {
  row: TData
  actions: RowActionItem<TData>[]
  /** 最多直接内联展示几个按钮，超出部分收进 "..." 菜单；默认 0（全部收进 "..." 菜单） */
  maxInline?: number
  triggerAriaLabel?: string
}

export function DataTableRowActions<TData>(props: DataTableRowActionsProps<TData>): ReactNode
```

- **行为要求**：
  1. 过滤掉 `hidden === true` 的项；若过滤后为空数组，渲染 `null`。
  2. 外层容器与触发器点击事件统一调用 `event.stopPropagation()`，防止触发行的 `onRowClick` 或展开详情。
  3. 非危险项按声明顺序排列；`destructive === true` 的项若有非危险项存在，自动在上方插入 `<DropdownMenuSeparator />` 并使用 `variant="destructive"`。
  4. 遵循 `@base-ui/react` / 项目现有 `src/components/ui/dropdown-menu.tsx` 的用法，不修改 `ui/` 目录。

### 2.4 服务端表格状态聚合 Hook `useServerTable`（#1）

- **新增文件**：`frontend/src/components/data-table/use-server-table.ts`（并在 `index.ts` 导出）
- **职责**：将服务端分页、排序、关键词防抖、高级查询重置、翻页重置（过滤条件变化时 `pageIndex` 自动归零）聚合为一个轻量 Hook，消除每个业务页面 20+ 行的重复状态同步代码。
- **接口设计**：

```ts
import type { PaginationState, SortingState } from "@tanstack/react-table"
import type { ExternalDateRange } from "./types"

export interface UseServerTableOptions<TFilters extends Record<string, unknown> = Record<string, unknown>> {
  defaultPageSize?: number
  defaultSorting?: SortingState
  initialKeyword?: string
  initialFilters?: TFilters
  debounceMs?: number // 默认 300ms
}

export interface UseServerTableResult<TFilters extends Record<string, unknown>> {
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
  sorting: SortingState
  onSortingChange: (sorting: SortingState) => void
  keyword: string
  debouncedKeyword: string
  setKeyword: (keyword: string) => void
  filters: TFilters
  setFilter: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void
  setFilters: (next: Partial<TFilters> | ((prev: TFilters) => TFilters)) => void
  dateRange: ExternalDateRange["value"]
  setDateRange: (range: ExternalDateRange["value"]) => void
  /** 重置搜索词、filters、dateRange 并将 pageIndex 归零（保留 sorting） */
  resetFilters: () => void
  /** 可直接展开传入 useQuery 的 queryKey 稳定参数快照 */
  queryParams: {
    page: number
    pageSize: number
    keyword: string
    sorting: SortingState
    filters: TFilters
    dateRange: ExternalDateRange["value"]
  }
}

export function useServerTable<TFilters extends Record<string, unknown> = Record<string, unknown>>(
  options?: UseServerTableOptions<TFilters>
): UseServerTableResult<TFilters>
```

- **关键行为**：
  - `setKeyword`、`setFilter`、`setFilters`、`setDateRange`、`onSortingChange` 更新时自动将 `pagination.pageIndex` 重置为 `0`。
  - `debouncedKeyword` 使用项目现有的 `useDebouncedValue(keyword, debounceMs)`；当 `resetFilters()` 被调用时，`keyword` 与重置后的页码立即生效。
  - 为 `use-server-table.ts`、`data-table-columns.tsx`、`data-table-row-actions.tsx` 编写对应的 Vitest 单元测试。

---

## 批次 3：内置错误态、加载微进度条、导出元数据消费与无障碍打磨（#10, #11, #12, #8, #15）

### 3.1 内置可选错误态 `error` 与 `onRetry`（#10）

- **修改文件**：
  - `frontend/src/components/data-table/types.ts`
  - `frontend/src/components/data-table/data-table.tsx`
- **新增 Props（均为可选，不传时保持原行为）**：

```ts
export interface DataTableProps<TData, TValue> {
  // ...既有属性
  /** 查询错误对象；传入非空值时，若无数据则渲染内嵌错误态（避免把接口报错误显示为“暂无数据”），若有陈旧数据则渲染顶部非阻塞错误提示条 */
  error?: unknown
  /** 错误态下的重试回调 */
  onRetry?: () => void
  /** 自定义错误标题（默认 "数据加载失败"） */
  errorTitle?: string
}
```

- **渲染规则**：
  1. **首次加载失败 / 无数据且报错（`Boolean(error) && !isLoading && data.length === 0`）**：
     - 不渲染 `DataTableEmpty`（防止用户误以为数据库为空）；
     - 在表格正文单元格（`colSpan={colSpan}`）内渲染紧凑版错误提示（复用或对齐 `src/components/common/query-error-state.tsx` 的视觉语义：显示 `AlertCircle` 图标、`errorTitle ?? "数据加载失败"`、从 `error` 提取的安全可读描述，以及存在 `onRetry` 时的“重试”按钮）。
  2. **保留陈旧数据刷新失败（`Boolean(error) && data.length > 0`）**：
     - 保留当前表格数据行可浏览；
     - 在工具栏下方、表格视口上方渲染一条紧凑的告警横幅（`role="alert"`，含错误信息与可选的“重试”按钮）。

### 3.2 后台刷新与翻页顶部微进度条（#11）

- **修改文件**：`frontend/src/components/data-table/data-table.tsx`
- **背景**：当前 `isRefreshing` 仅让工具栏刷新图标旋转，而 `keepPreviousData` 翻页或搜索防抖请求期间（`isRefreshing || viewport?.pending` 且已有数据 `data.length > 0 && !isLoading`），用户在表格视口区域缺乏直接的加载中感知。
- **实现要求**：
  - 在 `DataTableViewportArea` 容器顶部（表头上方，`z-30`）渲染一条 `h-0.5 w-full overflow-hidden bg-primary/15 pointer-events-none` 的进度条轨道（仅当 `(isRefreshing || config?.pending) && ready` 时显示）。
  - 内部指示条使用 `frontend/src/index.css` 中已定义的动画类：`h-full w-1/3 bg-primary animate-[var(--animate-progress-indeterminate)]`。
  - 附上 `role="progressbar"`、`aria-label="正在更新表格数据"`，保证无障碍可感知且不引发布局高度抖动（使用 `absolute inset-x-0 top-0` 贴合在视口顶部）。

### 3.3 剪贴板与客户端导出消费 `ColumnMeta.export`（#12）

- **修改文件**：
  - `frontend/src/components/data-table/data-table-clipboard.ts`
  - `frontend/src/components/data-table/data-table-clipboard.test.ts`（新增或扩展单测）
- **实现要求**：
  1. 在 `loadedRowsTSV(table, columnLabels)` 中：
     - 过滤可见列时，除了排除 `AUX_COLUMNS`（`select`、`__detail`、`actions`），还要检查 `column.columnDef.meta?.export?.enabled !== false`；若显式配置了 `meta: { export: { enabled: false } }`，则从复制/导出列中排除。
     - 列标题优先级：`column.columnDef.meta?.export?.label ?? columnLabels?.[column.id] ?? (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id)`。
  2. 新增并导出纯函数 `exportLoadedRowsCSV<TData>(table: Table<TData>, options?: { columnLabels?: Record<string, string>; filename?: string }): string`（生成带 UTF-8 BOM 的 RFC 4180 CSV 字符串；当传入 `filename` 且在浏览器环境时触发 Blob 下载），让简单表格无需后端接口即可一键导出当前已加载页，并自动遵循 `meta.export`。

### 3.4 无障碍（ARIA）与键盘细节打磨（#8）

- **修改文件**：
  - `frontend/src/components/data-table/data-table.tsx`
  - `frontend/src/components/data-table/data-table-column-header.tsx`
- **⚠️ E2E 选择器兼容性强约束（极其重要）**：
  - 现有 E2E 测试（`frontend/e2e/table-layout-pagination.spec.ts` 第 118、175、176 行及 `frontend/e2e/data-table-layout.spec.ts`）直接通过 `[aria-label="调整username列宽"]`、`[aria-label="调整name列宽"]`、`[aria-label="调整code列宽"]` 查找拖拽手柄！
  - 因此，列宽拖拽手柄的 `aria-label` **必须保持** `` `调整${header.column.id}列宽` `` **不变**（或同时在对应的 E2E 测试用例中同步更新选择器；推荐保持 `aria-label={`调整${header.column.id}列宽`}` 并补充 `title={columnLabels?.[header.column.id] ? `调整“${columnLabels[header.column.id]}”列宽` : undefined}` 及 `data-column-resize-handle={header.column.id}`，这样既提升可读性与可测试性，又保证现有 44 个 E2E 回归 100% 零破坏）。
- **其他 ARIA 增强**：
  1. 表头 `TableHead`：当列支持排序时，根据 `header.column.getIsSorted()` 挂载标准 `aria-sort="ascending" | "descending" | "none"`（若尚未在所有可排序 `th` 上完整覆盖则补齐）。
  2. 展开详情按钮：确保 `aria-expanded={isExpanded}` 与 `aria-controls` 对应详情行 ID。
  3. 表格容器：当传入 `totalRows` 时，在 `<Table>` 上挂载 `aria-rowcount={totalRows}`。

### 3.5 标注实验性 / 仅元数据字段的 JSDoc 边界（#15）

- **修改文件**：`frontend/src/components/data-table/types.ts`
- **实现要求**：
  为 `ColumnMeta` 中的 `edit`、`query`、`export` 补充清晰的 JSDoc 注释：
  - 明确说明 `export` 由 `loadedRowsTSV` / `exportLoadedRowsCSV` 及宿主导出逻辑消费；
  - 明确说明 `edit` 与 `query` 属于**宿主能力描述元数据（Capability Metadata）**，`DataTable` 不会根据前端元数据自动开放行内编辑事务或绕过服务端查询白名单，宿主页面需通过受控回调消费。

---

## 批次 4：交互式场景画廊与文档重构（#7, #14）

### 4.1 交互式场景画廊 Scenario Gallery（#7）

- **修改文件**：`frontend/e2e/fixtures/data-table/fixture-app.tsx`
- **背景**：`fixture-app.tsx` 目前已实现 `wide`、`long-text`、`tree`、`virtualized`、`grouped` 等全部测试场景，但需要手写 URL 参数 `?scenario=...` 切换。
- **实现要求**：
  1. **严格保持现有 E2E 兼容**：当 URL 不带 `gallery=1`（即现有 E2E 访问 `/__e2e__/data-table?scenario=wide` 等）时，DOM 结构与顶部布局保持不变，防止影响任何 E2E 坐标断言。
  2. **新增画廊导航模式**：当访问 `/__e2e__/data-table?gallery=1`（或新增切换开关）时，在页面顶部渲染一个紧凑的交互式控制栏（Scenario Switcher）：
     - 场景切换标签页：`wide`（宽表固定列/调宽）、`long-text`（长文本截断浮层）、`tree`（树形层级）、`virtualized`（万行虚拟滚动）、`grouped`（分组汇总）、`error`（新增：演示 `error` + `onRetry` 空表报错与陈旧数据报错横幅）、`presets`（新增：演示 `preset="simple" | "standard" | "advanced"` 与 `create*Column` / `DataTableRowActions`）。
     - 方向与视口快捷切换：`LTR / RTL` 切换按钮、`isRefreshing` 模拟开关、`error` 模拟开关。

### 4.2 重组 `frontend/src/components/data-table/README.md`（#14）

- **修改文件**：`frontend/src/components/data-table/README.md`
- **文档结构要求**：
  将现有长文档重组为层次清晰的 6 个章节（保留全部既有准确约束，不删减重要注意事项）：
  1. **快速开始（30 秒最小示例）**：展示 `preset="standard"` + `create*Column` + `DataTableRowActions` 的最简用法。
  2. **服务端标准接入（`useServerTable` + TanStack Query）**：展示完整的分页、排序、搜索防抖、错误态（`error` / `onRetry`）与刷新微进度条闭环代码。
  3. **核心能力配方（Recipes）**：
     - 固定列与操作列（`stickyActionColumn`、`enableColumnPinning`、窄屏自动降级）
     - 列宽拖拽与单列弹性伸展（`enableColumnResizing`、`autoSizeText`）
     - 单元格与行样式自定义（`headerClassName`、`cellClassName`、`getRowClassName`、`DataTableText`）
     - 跨页选择（`selectionArea` / `selectionScope`）与导出（`meta.export`、`exportLoadedRowsCSV`）
     - 树形表格、行详情（`renderDetail`）、分组与虚拟滚动（`virtualized`）
  4. **Props 与 Types 完整参考**：覆盖 `DataTableProps`、`DataTableToolbarProps`、`DataTablePaginationProps`、`ColumnMeta`（含 `@experimental` / 元数据边界说明）。
  5. **架构边界与不变量说明**：记录 `data-table-geometry.ts` 的几何规则、职责边界（服务端权限/事务归属业务宿主）。
  6. **测试与场景画廊指南**：说明如何运行单测、E2E 以及如何通过 `/__e2e__/data-table?gallery=1` 预览所有场景。

---

## 5. Codex 逐步执行与验收清单（Verification Checklist）

每完成一个批次，必须按顺序执行以下验证命令并确保全部通过：

1. **单元测试（Vitest）**：
   ```bash
   npm --prefix frontend test -- --run
   ```
   - 预期：原有 41 个单测 + 新增的 `data-table-geometry.test.ts`、`data-table-columns.test.tsx`、`data-table-row-actions.test.tsx`、`use-server-table.test.tsx`、`data-table-clipboard.test.ts` 全部通过。

2. **代码规范与类型检查（ESLint & TypeScript）**：
   ```bash
   npm --prefix frontend run lint
   npm --prefix frontend run build
   ```
   - 预期：零 Lint 错误、零 TypeScript 编译错误。

3. **端到端浏览器回归（Playwright E2E）**：
   ```bash
   PW_CHROME_CHANNEL=chrome npm --prefix frontend run test:e2e
   ```
   - 预期：布局、固定列、分页、排序、高级查询、树形与虚拟滚动等全部 E2E 用例通过，无新增控制台错误或 `ResizeObserver` 循环告警。

## 6. 实施记录

- 批次 1：几何纯函数、偏好 Hook、288 组几何矩阵及确定性 IME 时序；330 项单测、Lint、构建通过。
- 批次 2：预设、5 种列工厂、统一行操作、服务端状态 Hook；333 项单测、Lint、构建通过。
- 批次 3：内嵌／陈旧数据错误态、进度条、CSV/TSV 元数据消费及 ARIA；336 项单测、Lint、构建通过。
- 批次 4：交互画廊、六章手册，服务端示例经过 TypeScript 编译检查；336 项单测、Lint、构建通过。
- 国际化 #9 未实施。未改动 UI 原子组件或后端。
- 最终验收：337 项 Vitest 单测、ESLint、TypeScript/Vite 构建、140 项 Playwright E2E 全部通过。
- 发现并修复 LDAP 手机固定降级兼容问题；595px 用户表固定与手机降级均通过真实浏览器验证。
- 新画廊检查 pageerror 和 console error/warning，结果为空；原有故障注入用例仍会输出预期的动态模块加载错误，减少动态效果测试会输出既有 Motion 提示，未当作新增产品错误。
- 构建保留原有大于 500kB 的 chunk 提示。新增 happy-dom 仅用于开发期 Hook／组件单元测试，不进入生产依赖。
