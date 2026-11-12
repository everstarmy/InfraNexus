# DataTable 功能与使用手册

基于 React 19、TanStack Table v9、Base UI 和 Tailwind CSS。本文按当前源码更新于 2026-11-02；完整契约见 [主组件](data-table.tsx)、[类型](types.ts) 与 [入口导出](index.ts)。文中注明的用户列表行为由业务页面实现，权限、网络请求与事务由宿主负责。

1. [快速开始](#1-快速开始)
2. [服务端标准接入](#2-服务端标准接入)
3. [核心能力配方](#3-核心能力配方)
4. [Props 与 Types 完整参考](#4-props-与-types-完整参考)
5. [架构边界与不变量](#5-架构边界与不变量)
6. [测试与场景画廊](#6-测试与场景画廊)

## 1. 快速开始

```tsx
import { DataTable, createTextColumn, createNumberColumn, createActionsColumn } from '@/components/data-table'

type Member = { id: string; name: string; amount: number }
const columns = [
  createTextColumn<Member>({ accessorKey: 'name', title: '姓名' }),
  createNumberColumn<Member>({ accessorKey: 'amount', title: '数量' }),
  createActionsColumn<Member>({ actions: row => [
    { key: 'view', label: '查看', onSelect: () => console.info(row.id) },
  ] }),
]
export function Members({ data }: { data: Member[] }) {
  return <DataTable preset="standard" columns={columns} data={data} getRowId={row => row.id} />
}
```

操作列工厂内部使用 `DataTableRowActions`；实际业务将示例回调替换为打开详情等行为。

| 预设 | 操作列固定 | 调宽 | 普通固定列 | 密度／全屏／高级列设置 |
| --- | --- | --- | --- | --- |
| 不传 | 维持既有默认：关闭 | 关闭 | 关闭 | 关闭 |
| `simple` | 开启 | 关闭 | 关闭 | 关闭 |
| `standard` | 开启 | 开启 | 关闭 | 开启 |
| `advanced` | 开启 | 开启 | 开启 | 开启 |

显式同名属性优先；`layoutControls={{}}` 可关闭预设控制按钮，未传预设不改变旧页面默认行为。

## 2. 服务端标准接入

下面复用项目 `usersService` 和 TanStack Query。`useServerTable` 不请求数据、不处理权限；宿主将 `queryParams` 映射成服务端白名单支持的参数。

```tsx
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { DataTable, createTextColumn, useServerTable } from '@/components/data-table'
import { usersService } from '@/services/users'
import { emptyQuery } from '@/components/data-table/data-table-query'
import type { UserDTO } from '@/services/types'

const userColumns = [createTextColumn<UserDTO>({ accessorKey: 'username', title: '用户' })]
export function ServerUsers() {
  const state = useServerTable({ defaultPageSize: 20 })
  const query = useQuery({
    queryKey: ['users', state.queryParams],
    queryFn: async ({ signal }) => (await usersService.list({
      page: state.queryParams.page,
      page_size: state.queryParams.pageSize,
      keyword: state.queryParams.keyword || undefined,
      query: JSON.stringify({ ...emptyQuery(), sorts: state.queryParams.sorting.map(s => ({ field: s.id, desc: s.desc })) }),
    }, signal)).data,
    placeholderData: keepPreviousData,
  })
  return <DataTable preset="standard" columns={userColumns}
    data={query.data?.items ?? []} getRowId={row => row.id}
    serverPagination={{ ...state.pagination, total: query.data?.total ?? 0, onChange: state.onPaginationChange }}
    serverSorting={{ sorting: state.sorting, onChange: state.onSortingChange }}
    externalSearch={{ value: state.keyword, onChange: state.setKeyword }}
    loading={query.isPending} isRefreshing={query.isFetching}
    error={query.error} onRetry={() => void query.refetch()} onRefresh={() => void query.refetch()}
    viewport={{ mode: 'max-height', maxHeight: '60svh', pending: query.isPlaceholderData }}
    selectionDisabled={query.isPlaceholderData} />
}
```

该示例将排序映射为高级查询 `sorts`；新增列时必须符合服务端字段与排序白名单，不能仅更新前端箭头。`queryParams.page` 从 1 开始，`pagination.pageIndex` 从 0 开始。

Hook 提供 `keyword/debouncedKeyword/setKeyword`、`filters/setFilter/setFilters`、`dateRange/setDateRange`、`sorting/onSortingChange`、`pagination/onPaginationChange`、`resetFilters` 和稳定 `queryParams`。关键词默认防抖 300ms；搜索、筛选、日期或排序变更自动归零页码。`setFilters` 的对象参数合并，函数参数返回完整状态。`resetFilters` 清空关键词和日期，恢复 `initialFilters`，保留排序与页大小；重置后的查询关键词立即为空。

## 3. 核心能力配方

### 功能概览

| 类别 | 实际能力 | 接入边界 |
| --- | --- | --- |
| 数据展示 | 强类型列、客户端分页、服务端分页、加载骨架、空态、行点击 | `data` 由页面提供，组件不请求业务 API |
| 查询 | 搜索、离散多选、日期区间、排序、组合条件编辑 | 全量服务端语义由页面和后端实现 |
| 布局 | 自然高度、限高内滚动、填充高度、固定表头、横向滚动、固定列分界阴影、密度、全屏 | 填充模式需要明确的父容器高度 |
| 列 | 显隐、宽度、顺序、固定、布局偏好、截断/换行/全文查看 | 高级列控制须显式开启，窄容器会降级固定列 |
| 选择 | 当页复选、Shift 连选、可选行规则、受控选择 | 跨页 ID/全查询描述符由宿主维护 |
| 保存 | URL 状态、命名查询视图、列布局持久化 | 保存视图是本地存储，不是团队/云端共享 |
| 高级展示 | 树展开、行详情、当前页分组与汇总 | 懒加载、接口缓存和全量统计由页面实现 |
| 性能 | 可选行虚拟化、overscan、动态行高、锚点恢复 | 不替代服务端分页，不提供列虚拟化 |
| 复制/导出 | 原生文本选择、已加载行 CSV/TSV 与公式转义工具、工具栏导出插槽 | 默认不生成导出入口；服务端导出由宿主实现 |
| 编辑 | 可承载自定义单元格编辑器 | 无通用自动保存协议，草稿/冲突/离页保护由页面实现 |
### 快速接入

#### 最小客户端表格

```tsx
import { DataTable, DataTableColumnHeader, type ColumnDef } from '@/components/data-table'

type Member = { id: string; name: string; status: number }

const columns: ColumnDef<Member>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="姓名" />,
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => row.original.status === 1 ? '启用' : '停用',
  },
]

export function MembersTable({ members }: { members: Member[] }) {
  return (
    <DataTable
      columns={columns}
      data={members}
      getRowId={member => member.id}
      toolbarTitle={<h2>成员列表</h2>}
      searchKey="name"
      searchPlaceholder="搜索姓名"
      defaultPageSize={20}
      hideRefresh
    />
  )
}
```

此时 `members` 应包含需要参与客户端搜索、排序、分页的完整集合。列定义放在模块外或 `useMemo` 中，数据保持稳定引用。优先提供业务 ID；数组下标无法在插入、排序、跨页选择中稳定标识记录。

#### 导入约定

- 常规页面从 `@/components/data-table` 导入组件、`ColumnDef`、`Table`、选择和复制辅助函数。
- 高级查询、布局偏好、保存视图类型使用对应模块路径导入，见第 4 章；它们未全部经 `index.ts` 重导出。
- 使用本目录导出的 `ColumnDef<TData>`，不要直接套用 TanStack v8 示例的泛型或配置。仓库封装固定使用 v9 feature 类型。
- UI 原子组件来自 `@/components/ui`，业务接入不修改原子组件。
### 数据模式与受控查询

#### 三个服务端开关各管什么

| 属性 | 职责 | 不会自动做的事 |
| --- | --- | --- |
| `serverPagination` | 外部拥有页码、页大小、总数；`data` 是一页 | 不发送请求，不生成业务分页参数 |
| `serverFiltering` | 关闭本地筛选，并在没有 `serverSorting` 时关闭排序入口 | 不把工具栏状态自动发送给接口 |
| `serverSorting` | 外部拥有排序状态，使用服务端排序结果 | 不替后端实现字段白名单或多排序 |

仅设置 `serverPagination` 时，本地排序/筛选仍可能只作用于已加载的一页。应明确向用户说明该范围；若要求整个查询结果排序，使用服务端筛选/排序契约。当接口不支持排序时，开启 `serverFiltering` 并省略 `serverSorting`，组件会禁用排序入口。

#### 服务端接入示例

下面通过 `loadPage` 注入数据请求函数，完整连接查询状态与请求结果。此示例使用项目已有的 TanStack Query，需在上层配置 `QueryClientProvider`；请求函数接收 `signal` 并把它传给实际 HTTP 客户端。

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PaginationState, SortingState } from '@tanstack/react-table'
import { DataTable, type ColumnDef } from '@/components/data-table'

type RecordItem = { id: string; name: string }
type PageRequest = {
  pageIndex: number
  pageSize: number
  search: string
  sorting: SortingState
  signal: AbortSignal
}
type ServerTableProps = {
  // 不同数据源使用不同 resourceKey，避免查询缓存混用。
  resourceKey: string
  columns: ColumnDef<RecordItem>[]
  loadPage: (request: PageRequest) => Promise<{ items: RecordItem[]; total: number }>
}

export function ServerTable({ resourceKey, columns, loadPage }: ServerTableProps) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const result = useQuery({
    queryKey: ['table-example', resourceKey, pagination, search, sorting],
    queryFn: ({ signal }) => loadPage({ ...pagination, search, sorting, signal }),
  })

  if (result.isError) return (
    <div role="alert">
      加载失败
      <button type="button" onClick={() => void result.refetch()}>重试</button>
    </div>
  )

  return <DataTable
    columns={columns}
    data={result.data?.items ?? []}
    loading={result.isPending}
    getRowId={row => row.id}
    externalSearch={{ value: search, onChange: next => {
      setSearch(next)
      setPagination(current => ({ ...current, pageIndex: 0 }))
    } }}
    serverFiltering
    serverSorting={{ sorting, onChange: next => {
      setSorting(next)
      setPagination(current => ({ ...current, pageIndex: 0 }))
    } }}
    serverPagination={{ ...pagination, total: result.data?.total ?? 0, onChange: setPagination }}
    onRefresh={() => void result.refetch()}
    isRefreshing={result.isFetching}
  />
}
```

`pageIndex` 从 **0** 开始；接口若从 1 开始，由 `loadPage` 转换为 `pageIndex + 1`。`total` 必须是当前查询范围的总数，不是 `items.length`。改变页大小时需要接收完整的 `next`，不能只更新 `pageIndex`。

示例直接按搜索值请求。需要搜索防抖时，由宿主区分输入值与已提交查询值；查询缓存键和请求参数使用同一份已提交值。使用占位数据时，通过 `viewport.pending` 延迟位置恢复，并通过 `selectionDisabled` 禁止对旧行操作。
### 工具栏、搜索与筛选

工具栏默认分两行：第一行为标题及操作，第二行为搜索和筛选。没有内容的行不渲染。选中数据后，`selectionArea`（优先）或 `batchActions` 在第一行替换标题，不新增悬浮条。密度、全屏／还原按钮位于顶部工具栏，与“表格设置”并列；“表格设置”负责列管理。密度、全屏／还原、刷新及表格设置按钮统一仅显示图标，并保留悬停提示和无障碍名称；高级查询、保存视图与 `moreActions` 集中在“更多”。

```tsx
<DataTable
  columns={columns}
  data={members}
  toolbarTitle={<h2>成员列表</h2>}
  actions={<button type="button" onClick={openCreate}>新增</button>}
  toolbarControls={<span>业务状态提示</span>}
  searchLeading={<span>搜索范围</span>}
  searchTrailing={<button type="button" onClick={openMore}>更多筛选</button>}
  onRefresh={refetch}
  isRefreshing={fetching}
/>
```

上述片段中的 `columns/members/openCreate/openMore/refetch/fetching` 由宿主提供。`toolbarLeading` 是保留的旧标题别名，新代码使用 `toolbarTitle`。

- `searchKey` 指定单列搜索；不设置时使用全局搜索。
- `externalSearch` 让宿主拥有输入值；服务端搜索应使用此方式或外部共享搜索控件。
- `hideSearch` 适合父页面已有搜索框；`hideRefresh` 隐藏内置刷新；“列设置”默认不显示，可通过 `showViewOptions={true}` 或 `layoutControls={{ columns: true }}` 开启；显式开启的密度/全屏按钮仍在工具栏显示。
- 刷新按钮仅在提供 `onRefresh` 且未设置 `hideRefresh` 时出现；`isRefreshing` 禁用按钮并显示旋转图标。
- 内置工具按钮多于一个时使用 Button Group，单个时独立显示；自定义 `toolbarControls`、`actions` 不自动并入按钮组。

#### 离散筛选

```tsx
facetedFilters={[
  {
    columnId: 'status',
    title: '状态',
    options: [{ label: '启用', value: '1' }, { label: '停用', value: '2' }],
  },
]}
```

客户端平面列在未提供 `filterFn` 时会自动匹配这些字符串值。复杂数组字段应自行提供过滤函数。

服务端筛选提供 `selectedValues` 和 `onSelectedChange`，将选择转换成接口条件，并同时重置页码。`options[].count` 应明确是服务端统计还是当前已加载数据统计，不把当前页分布称为全量统计。

#### 日期筛选

`dateRangeKey="created_at"`、`dateRangeTitle="创建日期"` 可开启列日期筛选。单独使用 `DataTableDateRangeFilter` 时可传 `dateRange`、`onDateRangeChange` 控制状态。

内置日期筛选处理客户端日期范围；服务端的时区、日边界和半开区间转换由页面/接口确定。不要把浏览器本地日期未经转换当作统一 UTC 边界。
### 高度、滚动、密度与全屏

#### 自然高度与限高

```tsx
// 默认自然高度，随当前页行数增长。
viewport={{ mode: 'content' }}

// 数值为 px；也可使用有效 CSS 高度表达式，如 '60svh'。
viewport={{ mode: 'max-height', maxHeight: 480, mobileContent: true }}
```

达到最大高度后，**数据区域内部纵向滚动**，工具栏与分页在滚动区外；有界视口默认固定表头。横向溢出时使用原生滚动条，不额外展示提示行或滚动按钮。仅实际存在固定列的一侧提供分界阴影：横向滚动时浮现，停止约 200ms 后以 150ms 过渡淡出；静止或仅纵向滚动时不显示。阴影按视口顶部圆角裁剪，支持 RTL 和系统减少动态效果设置。`stickyHeader: false` 可关闭固定表头。

`mobileContent: true` 在小于 `md` 的屏幕取消限高和固定表头，使用页面自然滚动。无效、非正数或计算后不可用的最大高度回退自然高度，避免数据不可访问。

#### 填充剩余空间

```tsx
<div className="flex h-[70svh] min-h-0 flex-col">
  <DataTable columns={columns} data={rows} viewport={{ mode: 'fill' }} />
</div>
```

父链必须有确定高度，且参与收缩的 flex 容器设置 `min-h-0`。`fill` 无法自行推断一个无限高父元素的“剩余空间”。

#### 返回位置与查询边界

| 视口字段 | 用途 |
| --- | --- |
| `queryKey` | 已提交查询/业务范围；变化重置纵向位置 |
| `viewKey` | 显式视图切换；变化重置两个方向 |
| `pending` | 占位行仍属于旧查询时，等待真实数据就绪再处理位置 |
| `restoreKey` | 返回同一表格时的内存缓存键，建议包含用户 ID 与表格 ID |

刷新同一查询尽量保留位置，数据插入优先按行 ID 与像素偏移恢复。缓存最多 30 项，仅包含位置元数据，不保存业务行数据，也不跨浏览器重启持久化。

```tsx
viewport={{
  mode: 'max-height', maxHeight: '60svh',
  queryKey: committedScope,
  pending: query.isPlaceholderData,
  restoreKey: `members:${currentUserId}`,
}}
layoutControls={{ density: true, fullscreen: true }}
```

`layoutControls.density` 和 `layoutControls.fullscreen` 分别控制两个按钮是否显示；设为 `false` 或省略即隐藏，互不影响，也不受 `hideViewOptions` 影响。所有屏幕尺寸均仅展示图标，保留悬停提示和无障碍名称。

密度有 `compact/standard/comfortable`。全屏使用 Dialog，退出保持组件管理的表格状态；页面自定义编辑器若要跨子树重挂载保留草稿，应把状态放到表格外层。
### 列布局与文本

#### 基本列配置

- `accessorKey` 或 `accessorFn` 定义取值；使用 `accessorFn` 时显式提供稳定 `id`。
- `header` 可使用 `DataTableColumnHeader` 提供排序/隐藏菜单，`description` 或 `tooltip` 提供说明。
- `cell` 可渲染业务内容；不要显式设置 `cell: undefined` 覆盖默认单元格。
- 操作列建议 `id: 'actions'`，`enableSorting: false`、`enableHiding: false`。
- `size/minSize/maxSize` 控制列宽；`minSize === maxSize` 用于固定尺寸的选择/操作列。

```tsx
enableColumnResizing
enableColumnPinning
stickyActionColumn
initialColumnVisibility={{ created_at: false }}
initialColumnPinning={{ start: ['name'], end: ['actions'] }}
layoutControls={{ columns: true, density: true, fullscreen: true }}
tablePreference={{ userId: currentUserId, tableId: 'members', schemaVersion: 1 }}
```

`stickyActionColumn` 会把 `actions` 规范化到逻辑末端固定区，与其他末端固定列共用宽度和偏移；同一列不会同时固定在两边。在 LTR 中末端是右侧，RTL 中为左侧。仅开启此选项时保留内容自适应布局；开启调宽、普通固定列、详情、虚拟化或文本模式时使用定宽布局，表头和正文单元格裁剪越界内容。

`initialColumnPinning` 必须包含 `start/end` 两个数组；`stickyActionColumn` 约定固定 `actions` 列。开启 `layoutControls.columns` 或容器窄于 640px 时，固定预算按实际容器宽度计算，并为滚动数据保留约 160–240px 空间；不再以 640px 为界整体取消左固定。选择、详情、操作等辅助列优先保留，空间不足时普通业务列暂时取消 sticky 定位，已保存的固定偏好仍保留。恢复足够宽度后重新生效；不要依赖任意数量的宽列同时固定。

列宽手柄位于逻辑末端边界，拖拽时持续高亮；支持鼠标、触摸、方向键每次 12px 微调、Home 恢复、End 到最大值、双击恢复默认。RTL 下拖拽与方向键增减方向同步反转。可排序表头在列收窄时省略标题，优先保留排序方向、优先级与帮助图标；列宽仍需足以容纳这些控件。列设置中的采样调宽仅测量最多 100 条已加载记录的有限文本，不能保证覆盖全量远端内容。

#### 按列定制外壳样式

`meta.headerClassName` 为静态类名字符串，作用于 `<th>`；`meta.cellClassName` 作用于 `<td>`，支持字符串或 `(row, value) => string | undefined`。回调接收原始行与该单元格的访问器值，返回值经 `cn()` 与内置样式合并。`cell` 仍负责内容渲染。

```tsx
const amountColumn: ColumnDef<{ id: string; amount: number }> = {
  accessorKey: 'amount',
  header: '金额',
  meta: {
    headerClassName: 'text-right',
    cellClassName: (row) => row.amount < 0
      ? 'text-right tabular-nums text-destructive'
      : 'text-right tabular-nums',
  },
}
```

自定义类作用于实际数据表头和正文单元格；不要覆盖固定定位、层级或溢出规则，以免破坏布局。骨架、详情和汇总行不会自动套用业务列的正文样式。

#### 文本模式

```tsx
{
  accessorKey: 'description',
  header: '说明',
  size: 240,
  meta: { text: { mode: 'clamp', lines: 2, label: '完整说明' } },
}
```

`truncate` 单行截断、`wrap` 自然换行、`clamp` 限行。文本单元格配置针对字符串/数字，仅实际溢出时提供可键盘访问的全文入口，短文本保留普通可选择文本；列宽、字体与密度变化后重新检测。拖选不会打开全文浮层；复杂自定义 React 内容由 `cell` 自行实现。

#### 元数据能力声明

| `meta` 字段 | 类型 / 含义 |
| --- | --- |
| `text` | `{ mode: 'truncate' \| 'wrap' \| 'clamp'; lines?: number; label?: string }` |
| `layout` | `{ move?: boolean; pin?: boolean; hide?: boolean }` |
| `query` | `{ key: string; type: 'text' \| 'number' \| 'date' \| 'enum' \| 'boolean'; sensitive?: boolean }` |
| `export` | `{ enabled: boolean; label?: string; value?: (row: TData) => unknown }`；`value` 用于客户端 CSV/TSV 值 |
| `edit` | `{ enabled: boolean; input: 'text' \| 'number' \| 'date' \| 'enum' \| 'boolean' }` |

这些字段不自动创建业务 API，也不代替字段权限与服务端白名单。

#### 布局持久化与受控布局

`tablePreference` 按用户、表格、schema 版本隔离；保存显隐、顺序、尺寸、固定和密度。`initial*` 是默认值，已保存的有效偏好优先。未知列通过白名单处理，存储异常使用默认布局并提示。

需要页面统一拥有布局时传 `layoutState={{ value, onChange }}`，`value` 类型为 `ColumnPreferences`。不要同时让多个外部状态源争抢布局；应用命名视图时要同步页面布局和查询状态。
### 选择、批量操作与复制

#### 当页选择

```tsx
const columns: ColumnDef<Member>[] = [createSelectColumn<Member>(), ...businessColumns]

<DataTable
  columns={columns}
  data={members}
  getRowId={row => row.id}
  canSelectRow={row => row.status === 1}
  rowSelectionDisabledReason={() => '此记录不可选择'}
  selectionDisabled={query.isPlaceholderData || submitting}
  batchActions={(selectedRows, resetSelection) => (
    <button onClick={() => performBatch(selectedRows, resetSelection)}>
      操作已选 {selectedRows.length} 条
    </button>
  )}
/>
```

全选复选框作用于当前页可选数据。Shift 连选遵循显示顺序，虚拟模式包含当前页尚未挂载的中间行。

默认在查询/排序/分页范围变化时清除页内选择。`selectionScopeKey` 可显式定义清理边界；业务范围和操作者/权限变化必须纳入失效处理。`persistRowSelection` 不会自动构建安全的跨页选择协议。

#### 跨页与全查询选择

[选择辅助模块](data-table-selection.ts) 提供：

```ts
type TableSelection =
  | { mode: 'page' | 'ids'; ids: string[] }
  | { mode: 'allMatching'; excludedIds: string[] }
```

- `selectedOnPage(selection, pageIds)` 将描述符投影成当前页勾选状态。
- `updatePageSelection(selection, pageIds, next)` 合并本页变化；ID/排除集合上限 500，超过会抛错，需要页面捕获并提示。
- `controlledSelection={{ value, onChange }}` 只接收当前页投影；组件不会通过复选框自动下载全部 ID。
- `batchActions` 收到的是已加载选中行，不能用于推断 `allMatching` 的完整集合。执行全查询操作应提交描述符和稳定查询条件。
- 页面负责模式切换、查询失效、确认、权限变化清理、失败重试及服务端结果反馈。受控模式下，宿主必须显式清空失效的描述符。

以下片段放在拥有服务端分页状态的组件内，`items` 是当前页记录，`columns` 已包含 `createSelectColumn`。`selection` 在翻页时保留，查询变化时由宿主按模式处理失效。用户列表的 `ids` 模式支持跨搜索累计勾选，清空搜索后仍保留；批量启停和已选 CSV 导出提交累计 ID，移除搜索词并保留其他筛选条件。其他筛选或身份权限变化仍清空选择；`allMatching` 在搜索变化时清空，`page` 在搜索或分页变化时清空。需要所有模式都随查询清空的页面，也可以给拥有选择状态的子组件设置查询范围 `key`。

```tsx
import { useState } from 'react'
import {
  selectedOnPage, updatePageSelection, type TableSelection,
} from '@/components/data-table'

// 放在组件函数内：
const [selection, setSelection] = useState<TableSelection>({ mode: 'ids', ids: [] })
const [selectionError, setSelectionError] = useState('')
const pageIds = items.map(row => row.id)

// 传入 DataTable：
controlledSelection={{
  value: selectedOnPage(selection, pageIds),
  onChange: next => {
    try {
      const updated = updatePageSelection(selection, pageIds, next)
      setSelection(updated)
      setSelectionError('')
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : '无法更新选择')
    }
  },
}}
```

将 `selectionError` 渲染到表格旁的 `role="alert"` 区域。切换为全查询选择可使用 `setSelection({ mode: 'allMatching', excludedIds: [] })`；它只改变选择描述符，不加载全部记录。执行操作时同时提交描述符与当前查询条件。

配置 `selectionArea` 或 `batchActions` 时，分页栏左侧在零选择时仅显示总记录数；有选择时显示“已选数量 · 批量操作”和取消按钮。面板显示当前页数量、可选的全部匹配入口与业务操作。`selectionArea.count` 和 `estimated` 提供总选择数，`currentPageCount` 只用于当前页提示。未提供 `selectionArea` 时回退到表格内部的已加载过滤行选择数，服务端分页下不能代表跨页总量。关闭面板时操作内容由 `keepMounted` 保持；选择数归零时整个选择控件不渲染，不能依赖其内部状态保留。

#### 复制与导出

用户列表在工具栏 `exportControl` 中提供下载和复制入口，需有 `users:export` 权限。无选择时可下载当前页或全部匹配 CSV，或复制当前页 TSV；有选择时可下载已选 CSV 或复制已选 TSV。CSV 由后端重新查询、验证权限并生成；显式 ID 可跨搜索累计，全匹配范围使用当前查询。单次 CSV 最多 5000 条、8 MiB，显式选择或排除 ID 最多 500 个。实际导出数量以文件为准。

CSV 字段按当前可见列的顺序与前后端允许字段取交集；无可导出字段时回退用户名、姓名、邮箱和状态。部门输出名称；多个角色按名称排序后用“、”连接，未分配部门或角色时留空。关联名称沿用 CSV 转义和公式防护。TSV 在浏览器中只读取当前行模型；当前“复制已选 TSV”仅按 `ids` 模式匹配当前页，不能复制其他页或全匹配的完整集合。

表格不附加通用单元格复制按钮。文本可通过系统 `Cmd+C` / `Ctrl+C` 复制，选择文本不会触发行点击。截断内容可打开全文后选择复制；特殊字段如需独立复制按钮，由业务单元格提供。以下辅助函数用于显式的批量文本处理，不生成表格入口。

```ts
import { loadedRowsTSV, copyTableText } from '@/components/data-table'

await copyTableText(loadedRowsTSV([
  ['姓名', '状态'],
  ...loadedRows.map(row => [row.name, row.status]),
]))
```

`spreadsheetText` 处理公式前缀，`loadedRowsTSV` 处理制表符、换行与引号。已损失精度的大整数无法修复：ID、账号等应从接口开始用字符串；不安全整数 number 会被拒绝。

组件没有通用 `onExport` 属性；`exportControl` 接收节点或 `(table) => ReactNode`，供宿主将导出控件放入工具栏。当前页可调用 `exportLoadedRowsCSV`，远端全量范围与授权下载由页面实现。
### 高级查询、URL 与保存视图

#### 高级查询模型

提供 `advancedQuery` 时，表头显示排序优先级，修改已有排序列的方向保留其他排序；未排序列可选择“追加升序排序”（最多三列）。普通升/降序操作选择新列时替换排序。完整顺序与删除操作集中在“更多”中，隐藏列的排序仍可管理。若同时提供 `serverSorting`，它是表头排序的受控来源，宿主需将同一排序数组映射进 `advancedQuery.value.sorts`；否则表头直接调用高级查询的 `onChange`。

`advancedQuery.activeView` 可传 `{ id, snapshot }`，明确当前应用的视图及基准快照；仅在确实恢复默认视图时传入，URL 查询优先时不要冒认默认视图。变更该身份会同步菜单选中态，快照对象键顺序不影响“已修改”判断，排序数组顺序仍影响判断。


高级搜索或条件参与“筛选无匹配”空态判断。重置筛选保留排序与布局。组合使用受控搜索、筛选及服务端分页时，建议提供 `advancedQuery.onResetFilters(nextQuery)`：宿主在这一个回调中清空外部筛选、应用新查询、归零页码并更新选择范围，组件不再分别调用这些受控回调。未提供时保留分别通知的兼容行为。

日期与数字输入保留编辑草稿，仅在“应用查询”时转换并校验。日期必须包含 `Z` 或时区偏移，提交时规范化为 UTC；数字空串不解释为零。非法输入保留在编辑器中，能定位到字段的校验错误将聚焦对应输入。

从 `data-table-query.ts` 导入 `TableQuery/QueryField/emptyQuery/parseTableQuery`。结构如下：

```ts
const query: TableQuery = {
  version: 1,
  search: '',
  filter: { logic: 'and', children: [
    { field: 'status', op: 'eq', value: 1 },
    { field: 'name', op: 'contains', value: '研发' },
  ] },
  sorts: [{ field: 'created_at', desc: true }],
}
```

支持 AND/OR 条件组；运算符取决于字段类型，包括相等、不等、包含、范围、集合、空值等。解析限制：搜索 200 字符、最多 3 个排序、条件组最多 3 层、总条件最多 20。非法条件拒绝处理，不静默丢弃以扩大结果范围。

```tsx
advancedQuery={{
  value: query,
  fields,
  onChange: applyQuery,
  onApplyView: applySavedView,
  initialLayout: initialView?.layout,
}}
```

高级编辑器发出查询，不会直接调用接口或把整个查询自动转换成 TanStack 客户端过滤函数。宿主把字段映射到服务端白名单，并统一重置页码、排序与旧筛选状态。

字段配置示例（字段名必须与查询模型和请求层一致）：

```ts
import { emptyQuery, parseTableQuery, type QueryField } from '@/components/data-table/data-table-query'

const fields: QueryField[] = [
  { key: 'name', label: '姓名', type: 'text', sortable: true },
  { key: 'status', label: '状态', type: 'enum', options: [
    { label: '启用', value: 1 }, { label: '停用', value: 2 },
  ] },
  { key: 'created_at', label: '创建时间', type: 'date', sortable: true },
]
const initialQuery = emptyQuery()
const validated = parseTableQuery(initialQuery, fields)
```

`QueryField` 可选字段：`options` 定义枚举值，`nullable` 允许空值运算，`sensitive` 标记不可安全存储的字段，`sortable` 声明排序能力。`parseTableQuery(raw, fields, safeStorage?)` 返回规范查询或抛出异常；`safeStorage: true` 额外拒绝敏感过滤条件值；只保存字段标识与方向的排序不因敏感标记而被拒绝。外部输入必须捕获异常并提示用户。

#### URL 状态

`enableUrlSync` 需要 Router 上下文；不在 Router 内时走普通表格。`urlStateKey` 为同页多表添加前缀。

基础 URL 支持 `q` 或 `q_<searchKey>`、`f_<columnId>`、日期字段的 `<id>_from/<id>_to`、`sort`、`page/pageSize`；排序格式如 `name:asc,created_at:desc`。页面已有自己的受控 URL 查询时，应由页面统一管理，避免与内置同步重复写入。

`persistRowSelection` 的 URL 选择状态与安全的服务端选择描述符不是一回事；不要将敏感查询值或不必要的业务 ID 写入可分享 URL。

#### 保存视图

本地命名视图保存 `query + layout + pageSize`，需要 `advancedQuery` 和可用的表格偏好存储键。支持保存、应用、重命名、删除、默认视图及存储冲突提示。当前约束为最多 20 个视图、名称最多 50 字符，保存页大小遵循表格的页大小策略，默认 10/20/50/100。旧视图的页大小不再支持时回退为当前默认值，打开视图菜单时提示；其他视图仍可读取。

`TableViewSnapshot` 从 `data-table-views.ts` 导入。`onApplyView` 由宿主一次性应用查询、布局、页大小并归零页码；启动时应先解析默认视图，再建立初始请求状态，避免先请求默认值再重复请求恢复值。

保存视图仅存在当前浏览器存储，不提供跨设备或团队共享；敏感字段受安全存储校验，页面仍需处理用户切换与字段权限变化。
### 树、详情、分组与汇总

#### 树形行

```tsx
getSubRows={row => row.children}
defaultExpanded={true}
```

设置子行后，列需要显式渲染展开按钮：

```tsx
cell: ({ row }) => (
  <div style={{ paddingInlineStart: row.depth * 16 }}>
    {row.getCanExpand() && <button
      type="button"
      aria-expanded={row.getIsExpanded()}
      onClick={row.getToggleExpandedHandler()}
    >{row.getIsExpanded() ? '收起' : '展开'}</button>}
    {row.original.name}
  </div>
)
```

默认展开为空对象；`true` 展开所有层。可使用 `treeState={{ expanded, onChange, canExpand }}` 受控管理；`canExpand` 适合尚未加载子节点但已知有子项的节点。

分页按根行处理，展开子行不挤占根分页名额。过滤保留树语义；树结构下不启用平面 `groupBy`。`getSubRows` 是同步数据读取函数，不能直接返回 Promise；请求、加载/失败行、重试、折叠取消由宿主管理。展开未加载节点时，宿主获取子节点并更新 `data`，再由 `getSubRows` 返回新的同步子行集合。

#### 行详情

`detail={{ render: row => <Details id={row.id} /> }}` 自动增加独立的窄箭头列（保留 ID `__detail`，业务列勿使用），与选择列分开；组件管理单个详情 ID。详情请求与缓存必须在 `Details` 或宿主实现，并处理取消与权限变化。详情和树展开是不同状态，不共享后端加载协议。详情行采用稳定的浅底色，悬停时保持一致；父行保持展开状态底色，固定单元格同步体现该状态。

#### 当前页分组与汇总

```tsx
groupBy={{ label: '来源', key: row => row.source }}
summary={{ label: '当前页', render: rows => `共 ${rows.length} 行` }}
```

分组只针对平面当前页，保持选择跟随实际显示顺序；汇总使用当前页行模型，不是服务端全量聚合。树的展开行是否计入某个业务统计应由 `render` 明确处理，避免把根节点数、展开节点数和真实匹配数混用。

#### 草稿与刷新快照

`useDeferredTableData(data, scope, locked, pending?)` 位于独立模块，可在选中或编辑期间保持展示快照，并通过 `hasUpdate/accept` 提示用户接受新数据。查询范围变化仍加载自身数据。

它不是通用编辑器或事务锁。自定义编辑单元格时，宿主需要自行定义保存、取消、校验和冲突处理规则；`meta.edit` 仅声明能力，不生成输入控件。
### 按需虚拟化

```tsx
<DataTable
  columns={columns}
  data={largeLocalRows}
  getRowId={row => row.id}
  defaultPageSize={10000}
  pageSizeOptions={[10, 20, 50, 100, 10000]}
  maxPageSize={10000}
  viewport={{ mode: 'max-height', maxHeight: 520 }}
  virtualization={{ estimateRowHeight: 44, overscan: 6 }}
/>
```

此例适用于明确需要在当前页连续展示大量本地行的场景，不建议为了虚拟化扩大普通服务端分页。

- 默认关闭，`{}` 开启默认估算 44px、overscan 6；估算高度配置限制在 24–500px、overscan 在 1–20，实际动态高度仍按测量值。
- 必须有稳定 `getRowId`，并使用 `fill` 或有效 `max-height`；不能同时启用 `mobileContent`。
- 保留完整当前页模型，只挂载窗口和 overscan；支持动态行高、树展开、固定列/表头、分组表头和 Shift 跨未挂载行连选。
- 保留焦点行及相邻行；焦点记录被移除时回到滚动区。ARIA 提供当前页总行数和行序号，隐藏占位行。
- `detail` 或平面 `groupBy` 会明确提示回退；不支持的高度/ID 配置也会提示。
- “分页兼容模式”关闭窗口化并把页大小降到最多 100。切回虚拟模式不自动恢复大页大小。
- 浏览器原生查找、全文复制和打印只能看到挂载 DOM；使用分页模式或业务导出替代。
- 跨卸载不保存所有行的历史尺寸，按 ID 和估算重新校正；不承诺平滑滚动。

行虚拟化仍保留 O(N) 客户端行模型。组件不提供列虚拟化；大量列或复杂单元格仍有渲染成本。选择页大小时同时考虑客户端计算、接口响应体积和使用场景。
### 列工厂与统一行操作

- `createTextColumn`：`accessorKey/accessorFn`、`title`、`maxLines: 1|2|3`、`monospace`、`emptyText`、`renderSecondary`。`copyable` 仅显式开启时提供复制按钮，默认保持原生文本选择。
- `createNumberColumn`：默认右对齐、等宽数字、中文千分位，支持 `format(value,row)`、`unit`、`align`。
- `createDateColumn`：`mode: datetime|date|relative`、自定义格式，空值及无效日期显示 `emptyText ?? '—'`。
- `createBadgeColumn`：`options` 映射值到 `label/variant/className/icon`；自动调宽使用显示标签。
- `createActionsColumn`：默认 ID `actions`、宽 56px，不排序、不隐藏、不调宽、不参与导出；支持 `actions(row)` 或 `cell(row)`。
- 所有工厂保留 `size/minSize/maxSize`、能力开关及元数据；`accessorFn` 必须提供稳定 `id`。
- `DataTableRowActions`：`row`、`actions`、`maxInline`（默认 0）、`triggerAriaLabel`；项含 `key/label/icon/onSelect/hidden/disabled/disabledReason/destructive`。隐藏项不渲染，危险项在末尾，点击不冒泡到行；全隐藏时返回 `null`。危险操作的确认和权限仍由宿主执行。

### 错误、刷新与当前页导出

`error` 非空且无数据、非首次加载时显示内嵌错误，避免误报空表；有陈旧数据时保留行并显示告警横幅。`errorTitle` 默认“数据加载失败”，`onRetry` 可选；使用项目 API 错误文案适配器，不直接展示任意错误堆栈。`loading` 仍负责首次骨架。有数据且非首次加载时，`isRefreshing` 或 `viewport.pending` 会显示顶部微进度条，且不改变布局高度。

```tsx
import { loadedRowsTSV, exportLoadedRowsCSV } from '@/components/data-table'
// table 为 onTableInstance 返回的强类型表格实例。
const tsv = loadedRowsTSV(table, { name: '姓名' })
const csv = exportLoadedRowsCSV(table) // 返回带 UTF-8 BOM 的 RFC 4180 字符串
exportLoadedRowsCSV(table, { filename: 'members.csv' }) // 浏览器下载
```

上述 table 重载读取 `table.getRowModel().rows`，按可见 start/center/end 列顺序处理当前页行模型，排除辅助列及 `meta.export.enabled === false` 的列；标题优先 `meta.export.label`，其次显式标签、字符串表头、列 ID。值优先使用 `meta.export.value(row.original)`，否则使用 `row.getValue()`；不会自动应用 UI 单元格格式化。保留公式注入转义；原有 `loadedRowsTSV(unknown[][])` 矩阵签名继续有效。客户端 `data` 中已加载但不在当前页行模型的记录不会导出；树形展开行按当前实际行模型导出，平面分组标题不是数据行。全部匹配结果与已加载集合、当前页是不同范围；服务端全量导出仍由宿主提供。

导出值遵循现有 `String(value)` 规则：空值变为空字符串，日期使用平台日期字符串，数组通常为逗号连接，对象通常为 `[object Object]`；不会静默转换为 JSON、ISO 日期或 UI 格式。字符串大整数保持原文，不安全整数数值抛错。序列化全部成功后才创建下载资源，anchor 立即移除，Object URL 在后续任务撤销。

## 4. Props 与 Types 完整参考

### 完整属性速查

以下省略 ReactNode、TanStack 状态类型的展开定义；完整签名以 [源码](data-table.tsx) 为准。

| 属性 | 默认 / 说明 |
| --- | --- |
| `columns` | 必填，`ColumnDef<TData, TValue>[]` |
| `data` | 必填，当前数据集合或服务端一页数据 |
| `loading` | `false`；无数据时显示复用可见列宽、辅助列和固定偏移的骨架，有数据时保留已有行。不自动发请求 |
| `getRowId` | 可选行键函数；强烈建议使用稳定业务 ID |
| `serverPagination` | `{pageIndex,pageSize,total,onChange}`，受控服务端分页 |
| `defaultPageSize` | `10`；受控分页时以外部状态为准 |
| `maxPageSize` | 默认 `100`；过滤分页选项、URL 与视图恢复允许的页大小。大数据客户端虚拟表可显式提高；服务端表格不得超过接口上限 |
| `pageSizeOptions` | `[10,20,50,100]` |
| `serverFiltering` | `false`，开启手动过滤并禁止未声明的服务端排序 |
| `serverSorting` | `{sorting,onChange}`，受控全范围排序 |
| `searchKey` | 指定搜索列；缺省全局搜索 |
| `searchPlaceholder` | 搜索输入占位文字 |
| `externalSearch` | `{value,onChange}`，受控输入 |
| `hideSearch` | `false`，隐藏内置搜索 |
| `facetedFilters` | `[]`，离散筛选配置 |
| `externalDateRange` | `{value: DateRange \| undefined, onChange, title?}`；无需日期列，优先于 dateRangeKey，参与重置与空态。高级查询提供原子重置回调时由宿主一并清空日期 |
| `dateRangeKey` / `dateRangeTitle` | 日期列与标题 |
| `toolbarTitle` | 第一行标题/说明/计数 |
| `toolbarLeading` | 旧标题别名，新代码使用 `toolbarTitle` |
| `searchLeading` / `searchTrailing` | 搜索行前后插槽 |
| `moreActions` | 收进“更多”浮层的低频操作，与高级查询及保存视图合并 |
| `toolbarControls` | 第一行内置按钮前的控制区 |
| `exportControl` | `ReactNode \| ((table: Table<TData>) => ReactNode)`；工具栏导出控件插槽，宿主负责下载和权限 |
| `actions` | 第一行业务操作按钮 |
| `hideRefresh` / `hideViewOptions` / `showViewOptions` | 刷新默认不隐藏；列设置默认隐藏，可通过 `showViewOptions={true}` 或 `layoutControls.columns` 显式开启 |
| `onRefresh` / `isRefreshing` | 刷新回调与进行中状态，后者默认 `false` |
| `columnLabels` | 列 ID → 友好名称 |
| `enableColumnResizing` | `false`，开启调宽 |
| `enableColumnPinning` | `false`，开启普通固定列 |
| `stickyActionColumn` | `false`，按 `actions` ID 固定操作列 |
| `initialColumnVisibility` | `{}`，默认显隐，已保存偏好可覆盖 |
| `initialColumnPinning` | `{start:[],end:[]}`，默认固定列 |
| `tablePreference` | `{userId,tableId,schemaVersion}`，持久化作用域 |
| `layoutControls` | `{density?,fullscreen?,columns?}`，各项显式开启 |
| `layoutState` | `{value,onChange}`，受控 `ColumnPreferences` |
| `viewport` | 默认自然高度；三种模式及位置字段见[视口与滚动](#高度滚动密度与全屏) |
| `virtualization` | 默认关闭；`{estimateRowHeight?,overscan?}` |
| `advancedQuery` | `{value,fields,onChange,onApplyView,onResetFilters?,activeView?,initialLayout?}` |
| `enableUrlSync` | `false`，Router 内开启基础 URL 同步 |
| `urlStateKey` | 多表 URL 参数前缀 |
| `persistRowSelection` | `false`，保留选择策略；不等于完整跨页业务协议 |
| `selectionScopeKey` | 显式选择失效边界 |
| `controlledSelection` | `{value,onChange}`，当前页 RowSelectionState 投影 |
| `canSelectRow` | 按业务行判断可选性 |
| `rowSelectionDisabledReason` | 不可选原因文本 |
| `selectionDisabled` | `false`，占位或执行阶段禁用选择 |
| `selectionArea` | `{count,currentPageCount,estimated?,disabled?,onClear,selectAll?:{count,onSelect},actions}`；优先于 batchActions，在分页栏显示选择及操作；零选择时不渲染操作面板 |
| `batchActions` | `(selectedRows,resetSelection) => ReactNode` |
| `onRowClick` | 行点击回调；按钮、输入框等交互目标不触发行点击 |
| `rowClassName` | 按行返回业务强调样式，使用语义主题色 |
| `onTableInstance` | 取得封装后的强类型 Table 实例 |
| `getSubRows` | 同步获取树子行 |
| `defaultExpanded` | `{}`；可传 `true` 或展开状态映射 |
| `treeState` | `{expanded,onChange,canExpand?}`，受控树展开 |
| `detail` | `{render,width?:"viewport"\|"table"}`；默认视口宽度，内部宽内容自行滚动，显式 table 可占整表宽 |
| `groupBy` | `{label,key}`，平面当前页分组 |
| `summary` | `{label,render}`，当前页汇总 |
| `emptyTitle` / `emptyDescription` | 原始空表的提示 |
| `emptyAction` | 原始空表的操作；筛选无匹配时使用重置筛选入口 |

#### 常用嵌套配置类型

以下结构便于查阅；正式类型请从对应模块导入，不需要在业务中重复声明。

```ts
// data-table-layout.ts（也从主组件导出）
type DataTableViewport = (
  | { mode: 'content'; maxHeight?: never }
  | { mode: 'max-height'; maxHeight: string | number }
  | { mode: 'fill'; maxHeight?: never }
) & {
  mobileContent?: boolean
  stickyHeader?: boolean
  queryKey?: string
  pending?: boolean
  viewKey?: string
  restoreKey?: string
}

// data-table-preferences.ts
interface ColumnPreferences {
  density: 'compact' | 'standard' | 'comfortable'
  columnVisibility: Record<string, boolean>
  columnPinning: { start: string[]; end: string[] }
  columnSizing: Record<string, number>
  columnOrder: string[]
}

// data-table-views.ts
interface TableViewSnapshot {
  query: TableQuery
  layout: ColumnPreferences
  pageSize: number
}
```

#### 主要回调签名

| 回调 | 参数与返回值 | 接入说明 |
| --- | --- | --- |
| `getRowId` | `(row: TData, index: number) => string` | 返回跨刷新稳定、集合内唯一的 ID |
| `onRowClick` | `(row: TData) => void` | 收到原始数据，不是 TanStack Row |
| `rowClassName` | `(row: TData) => string \| undefined` | 返回行样式类 |
| `canSelectRow` | `(row: TData) => boolean` | 决定当前行是否可选择 |
| `rowSelectionDisabledReason` | `(row: TData) => string` | 提供不可选原因 |
| `onTableInstance` | `(table: Table<TData>) => void` | 使用本目录的 Table 类型；回调应保持稳定 |
| `batchActions` | `(selectedRows: TData[], resetSelection: () => void) => ReactNode` | 渲染选中行操作；异步操作完成后自行调用重置 |
| `serverPagination.onChange` | `(next: PaginationState) => void` | 同步接收新的 `pageIndex/pageSize` |
| `serverSorting.onChange` | `(next: SortingState) => void` | 数组项为 `{ id: string; desc: boolean }` |
| `controlledSelection.onChange` | `(next: RowSelectionState) => void` | 映射为行 ID 到布尔值，不是 updater 函数 |
| `detail.render` | `(row: TData) => ReactNode` | 渲染详情内容 |
| `summary.render` | `(rows: TData[]) => ReactNode` | 渲染当前页行模型汇总 |
| `getSubRows` | `(row: TData, index: number) => TData[] \| undefined` | 同步返回子行 |
### 独立组件与辅助模块

| 文件 / 导出 | 职责与主要接入点 |
| --- | --- |
| [index.ts](index.ts) | 公开导出入口 |
| [DataTableColumnHeader](data-table-column-header.tsx) | `column/title/description?/tooltip?`，排序与隐藏菜单 |
| [DataTableToolbar](data-table-toolbar.tsx) | 表格工具栏及 `FacetedFilterConfig` |
| [DataTablePagination](data-table-pagination.tsx) | `table/pageSizeOptions?/totalCount?/selection?`，分页、页大小、合法页跳转；`selection: {count, estimated?}` 覆盖内部选择计数 |
| [DataTableFacetedFilter](data-table-faceted-filter.tsx) | `column/title/options/selectedValues/onSelectedChange` |
| [DataTableDateRangeFilter](data-table-date-range-filter.tsx) | `column/title/dateRange/onDateRangeChange` |
| [DataTableViewOptions](data-table-view-options.tsx) | 列设置菜单；通常由 DataTable 工具栏接入 |
| [DataTableSkeleton](data-table-skeleton.tsx) | `embedded/columnCount/rowCount/showCheckbox`；独立默认 6 列、5 行、含复选框 |
| [DataTableEmpty](data-table-empty.tsx) | `isFiltered/title/description/onResetFilters/action` |
| [data-table-query.ts](data-table-query.ts) | 查询类型、运算符、验证与条件标签 |
| [data-table-preferences.ts](data-table-preferences.ts) | `ColumnPreferences`、作用域键、列白名单迁移 |
| [data-table-views.ts](data-table-views.ts) | `TableViewSnapshot`、视图存储编解码 |
| [data-table-selection.ts](data-table-selection.ts) | 跨页选择描述符、当前页投影与集合上限 |
| [data-table-clipboard.ts](data-table-clipboard.ts) | `spreadsheetText/loadedRowsTSV/copyTableText/exportLoadedRowsCSV` |
| [use-deferred-table-data.ts](use-deferred-table-data.ts) | 交互期间保持数据快照 |
| [data-table-layout.ts](data-table-layout.ts) | 视口/密度/文本配置类型；这些类型也由主组件重导出 |
| [data-table-virtual-body.tsx](data-table-virtual-body.tsx) | 内部虚拟正文；页面使用主组件 `virtualization` 接口 |
### 新增属性与模块

| API | 类型与行为 |
| --- | --- |
| `preset` | `simple | standard | advanced`，显式属性覆盖默认值 |
| `error/onRetry/errorTitle` | `unknown / (() => void) / string`，首次失败与陈旧数据错误区分 |
| `totalRows` | 可选 `number`，优先作为 `aria-rowcount`；其次服务端分页总数；虚拟表再回退到当前页行数 |
| `DataTablePagination.selection` | `{count:number, estimated?:boolean}`，优先于内部选中模型 |
| `ColumnMeta.headerClassName` | 静态字符串，作用于真实表头 |
| `ColumnMeta.cellClassName` | 字符串或 `(row,value) => string | undefined`，作用于真实正文单元格 |
| `ColumnMeta.export` | `{enabled:boolean,label?:string,value?:(row:TData)=>unknown}`，由客户端导出与宿主消费 |
| `ColumnMeta.edit/query` | 宿主能力描述；不自动启用事务、不绕过服务端白名单 |

`DataTableToolbar` 的受控接口见 [定义](data-table-toolbar.tsx)：`table`、搜索/日期/筛选、标题和插槽、`hideRefresh/hideViewOptions`、`onRefresh/isRefreshing`、`layoutButtons`、`selectionArea/batchActions`、列管理与重置回调。`layoutButtons` 为内置图标按钮数组，多于一个自动组成 Button Group；页面通常通过 DataTable 的 `layoutControls` 使用。

### DataTableToolbarProps 与 DataTablePaginationProps

这两个 Props 类型均从入口导出，可独立组合基础组件。全部属性均以 `?` 表示可选。

| 工具栏属性 | 类型／用途 |
| --- | --- |
| `table` | `Table<TData>`，必填 |
| `searchKey? / searchPlaceholder?` | 单列搜索字段／占位文案 |
| `externalSearch?` | `{value:string,onChange:(value:string)=>void}`，受控搜索 |
| `hideSearch? / hideRefresh? / hideViewOptions? / showViewOptions?` | 独立控制搜索、刷新、列管理（列设置默认隐藏） |
| `facetedFilters?` | `FacetedFilterConfig[]`，见筛选配方 |
| `externalDateRange?` | `{value:DateRange|undefined,onChange,title?}`，受控日期 |
| `dateRangeKey? / dateRangeTitle?` | 本地日期字段／筛选标题 |
| `columnLabels?` | `Record<string,string>`，列显示名 |
| `toolbarTitle? / toolbarLeading?` | 标题节点／旧别名 |
| `searchLeading? / searchTrailing?` | 搜索行前后插槽 |
| `toolbarControls? / actions?` | 顶部自定义控制／业务操作插槽 |
| `exportControl?` | `ReactNode`，工具栏导出控件插槽 |
| `layoutButtons?` | `ReactNode[]`，内置按钮数组，自动按数量分组 |
| `settingsControls?` | `ReactNode`，独立使用工具栏时的列设置扩展插槽 |
| `enableColumnPinning? / columnManagement?` | 开放固定菜单／高级列管理 |
| `onAutoSize? / onResetLayout?` | `(id:string)=>void`／`()=>void` |
| `isFiltered? / onResetFilters?` | 受控筛选状态／清空回调 |
| `onRefresh? / isRefreshing?` | 刷新回调／刷新中状态 |

分页 Props：`table: Table<TData>` 必填；`pageSizeOptions?: number[]` 默认 `[10,20,50,100]`；`totalCount?: number` 优先于内部过滤行数；`selection?: {count:number,estimated?:boolean}` 优先于已加载行选择模型；`selectionArea?` 和 `batchActions?` 用于分页栏选择操作。改变页码与页大小通过表格实例回调，调用方须接收完整分页状态。

所有新模块都从 [index.ts](index.ts) 导出：[几何函数](data-table-geometry.ts)、[偏好 Hook](use-column-preferences.ts)、[列工厂](data-table-columns.tsx)、[行操作](data-table-row-actions.tsx)、[服务端 Hook](use-server-table.ts)。原有排序、查询、偏好和视图的专用模块导入路径继续保留。

## 5. 架构边界与不变量

### 异常、权限与并发

- **请求与错误来源由页面负责**。将查询错误传入 `error`、重试交给 `onRetry`，可使用内置空表错误态／陈旧数据横幅；已有宿主错误边界也可继续使用，避免同时重复提示。
- `loading` 用于首次加载；后台刷新使用 `isRefreshing`，保留已展示数据；占位数据需有可见提示并禁用可能误操作的按钮。
- 组件不内置权限系统；宿主控制操作入口，服务端重新鉴权。隐藏列、存储隔离、`meta.edit/export` 不能保护接口。
- 批量操作的确认、执行进度和结果反馈由宿主提供，成功后按需要刷新数据和重置选择。
- 受控选择和批量描述符应在身份、权限、业务范围变化时失效。服务端失败明细不能被本地“全成功”提示覆盖。
- 编辑保存处理版本冲突、重试和失败草稿；撤销是新的业务请求，不是简单回写旧缓存。表格不自动发送编辑请求。
### 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 配了最大高度却没有内部滚动 | 当前页是否足够高；是否误开 `mobileContent`；CSS 高度是否有效 |
| `fill` 撑开页面 | 父链是否有确定高度及 `min-h-0`；不要给无限高父容器使用填充模式 |
| 服务端排序按钮消失 | `serverFiltering` 开启但没有 `serverSorting`；只有后端支持时才补契约 |
| 排序只影响当前页 | 只有 `serverPagination`，未接入手动排序；明确页内范围或增加真实服务端排序 |
| 改了页大小又回到原值 | 受控宿主只更新页码或固定 `pageSize`；接收完整 `next` 状态 |
| 切换范围后看见旧行 | 查询使用占位数据；显示提示、传 `viewport.pending` 并禁用写入 |
| 改了初始列配置不生效 | 同作用域已有持久化偏好；提供重置入口，不随意删除用户存储 |
| 业务固定列暂时不固定 | 高级列管理按实际剩余空间降级；辅助列优先，宽度恢复后自动重新固定；也检查已保存视图与固定偏好 |
| `summary` 数字小于服务端总数 | 它统计当前页行模型；全量汇总应由服务端按同一查询返回 |
| `batchActions` 只有本页数据 | 参数是已加载选中行；全查询操作使用宿主维护的描述符 |
| 隐藏列仍可从接口看到数据 | 列显隐是显示偏好；字段级安全由接口实施 |
| 挂载树没有展开按钮 | `getSubRows` 提供模型，按钮需由列单元格显式渲染 |
| 虚拟化没有启用 | 查看提示：稳定 ID、限高/fill、关闭 mobileContent、禁用 detail/groupBy |
| 查找/打印漏掉虚拟行 | 浏览器只能访问挂载 DOM；切到分页兼容模式或使用导出 |
| 剪贴板失败 | 安全上下文、用户手势和浏览器权限；捕获辅助函数异常并反馈 |
| 大整数复制后已变形 | 接口或 JS number 早已损失精度；从源头改用字符串 |
| 同页多表争抢 URL | 为每张表提供不同 `urlStateKey`，或统一由页面控制 URL |
### 接入检查与维护

接入前确认以下配置：

- **数据与查询**：`data` 是全集还是一页；搜索、筛选、排序是否在同一范围执行；服务端总数是否对应当前查询。
- **身份与选择**：提供稳定 `getRowId`；明确受控选择的清理条件；批量操作使用正确的选择范围。
- **布局**：限高使用 `max-height`；填充使用有确定高度的父容器；虚拟化满足[行虚拟化](#按需虚拟化)的组合要求。
- **状态**：分别展示加载、空数据、筛选无匹配、请求失败与刷新状态；请求失败不冒充空数据。
- **持久化**：提供独立的 `tablePreference` 与 `urlStateKey`；列结构变化时评估 schema 版本和已有偏好的兼容性。

修改组件后，按涉及的功能检查空态、分页边界、中文输入、窄屏、键盘操作和主题。树表检查根行分页；虚拟化检查动态行高、末行可见、焦点与滚动位置。测试文件与实现文件位于本目录，浏览器测试位于 `frontend/e2e`。

维护文档时同步更新属性速查和示例，保持与 [主组件签名](data-table.tsx)、[类型声明](types.ts) 和 [公开导出](index.ts) 一致。

#### 受控页大小策略

`pageSizeOptions={[15, 200]}`、`defaultPageSize={15}`、`maxPageSize={200}` 共同定义有效选项；非法/重复/超上限选项被过滤，默认值不在选项中时取第一个有效值。宿主调用 `queryUrlPagination`、`decodeViews` 或 `readDefaultView` 时传入同一策略；服务端受控分页初值也应通过该策略恢复。虚拟表的分页兼容模式仍限制为 100 条。

选择操作区的 `count` 是宿主计算的跨页数量，`currentPageCount` 仅统计本页；全匹配数量设置 `estimated`，执行预检和权限继续由宿主负责。选择存在时 `actions` 位于分页栏弹层；业务组件不应重复输出取消选择和全匹配入口。

#### 显示与输入补充

- `ColumnDef.meta.autoSizeText(row)` 为自动调宽提供实际显示文本；未提供时仍采样原始字符串/数字。最多前 100 行，每个文本最多 500 字符，保留列 min/max 限制，不调整固定尺寸辅助列。
- `ColumnDef.meta.headerClassName`（静态字符串）与 `ColumnDef.meta.cellClassName`（字符串或 `(row, value) => string | undefined` 回调）用于按列或按单元格定制表头 `<th>` 与单元格 `<td>` 的外壳样式（如右对齐、等宽数字、自定义内边距或条件着色），并经 `cn()` 合并。
- 虚拟行未显式配置 `estimateRowHeight` 时，紧凑/标准/宽松采用 36/44/60px 初始估算；显式值优先，实际 DOM 测量为准。密度切换重新测量，并恢复可见行锚点。
- 高级枚举多选支持搜索、勾选、选中计数和清空，数字与字符串保持原类型；空集合应用时继续报错，不隐式解释为全部。
- 详情与分组内容默认约束在视口内，详情可显式设置 `width: "table"` 使用整表宽度。
- 正文、骨架和表尾共享密度内边距；表头维持稳定高度。首次未知内容仍可能产生行高变化，骨架不承诺预测任意业务单元格高度。

#### 固定与安全存储边界

`stickyActionColumn` 只固定操作列，不开放其他列的固定菜单；只有 `enableColumnPinning` 开启时才使用数据列的固定偏好。`QueryField.sensitive` 阻止过滤条件值进入视图和分享链接，不阻止仅含字段标识与方向的排序。排序仍必须符合字段白名单与 `sortable` 限制。
### 几何约束

- 可见列始终按 `[...start, ...center, ...end]` 计算和渲染；选择列 42px 在详情列 36px 前，固定详情偏移为 42px。
- 单独固定操作列不触发 `sizedLayout`；保留调宽、普通固定、详情、虚拟化、文本模式的既有触发条件。
- 仅首个符合条件的非固定数据列伸展，其余保持基准像素宽度；表头与正文保留越界裁剪。
- `computeTableGeometry` 为纯函数；`narrowPinnedColumns` 表示启用预算降级，不表示无条件清空左固定。辅助列优先，数据区域保留 160–240px 空间。方向用逻辑 start/end。
- `normalizeColumnPinning(pinning, boolean)` 旧签名兼容，新增 options 支持列 ID 白名单与能力限制。
- `useColumnPreferences` 负责作用域化本地持久化、受控布局、跨标签同步和更新；服务端授权、保存事务与批量执行始终归宿主。

### 内部职责与稳定性证据

主组件保留 Table 装配、受控状态与编排；[兼容判断](data-table-compatibility.ts)、[稳定表头](data-table-header.tsx)、[稳定正文行](data-table-body-row.tsx) 与[布局样式适配](data-table-styles.ts) 为内部模块，不从 barrel 公开。几何每轮生成一次，表头、单元格、colgroup 和 skeleton 共用适配；自然布局仍使用 TanStack offset。

[组合矩阵](../../../../docs/data-table/STABILITY_COMBINATIONS.md) 标明支持、条件支持及原回退；[执行记录](../../../../docs/data-table/STABILITY_EXECUTION_CHECKLIST.md) 与[性能前后记录](../../../../docs/data-table/STABILITY_PERFORMANCE.md) 区分本轮验证和历史验收。原历史测试数量不作为本轮通过数量。

## 6. 测试与场景画廊

```bash
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
PW_CHROME_CHANNEL=chrome npm --prefix frontend run test:e2e
```

开发服务器启动后访问 `/__e2e__/data-table?gallery=1`（仅开发环境别名），或 `/e2e/fixtures/data-table/index.html?gallery=1`。画廊包含 wide、long-text、tree、virtualized（10000 行）、grouped、error、presets；提供 LTR/RTL、模拟刷新、模拟错误与预设切换。error 场景可切换空数据并重试，presets 展示列工厂和统一行操作。未带 `gallery=1` 时不增加控制栏，保留现有测试布局。

几何单测覆盖选择/详情、两侧固定、布局模式、390/595/768/1280px；偏好、列工厂、行操作、服务端 Hook 和导出均有 Vitest 测试。浏览器回归检查实际固定坐标、滚动、窄屏降级、排序、选择与详情，不能只用构建成功代替交互验证。
