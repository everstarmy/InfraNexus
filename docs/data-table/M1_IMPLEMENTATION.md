# M1：滚动与布局接入说明

日期：2026-10-28。状态与证据见 [M1 验收](M1_VALIDATION.md)。本阶段不新增后端接口或依赖。

## 高度与滚动容器

`DataTable` 新增可选的 `viewport` 判别联合。旧调用不传时保持自然高度。

| 配置 | 行为 |
| --- | --- |
| `{ mode: 'content' }` | 数据区随内容增长；页面负责纵向滚动 |
| `{ mode: 'max-height', maxHeight: 420 }` | 420px 只约束数据区；少行自然收缩，多行内部滚动 |
| `{ mode: 'max-height', maxHeight: '60svh' }` | 接受有效 CSS 高度表达式，工具栏与分页不计入上限 |
| `{ mode: 'fill' }` | 填充具有确定高度的父级，扣除工具栏和分页占高 |

`maxHeight` 的非正数、无效 CSS、无界关键字或实际计算为零的高度降级为自然高度。`fill` 的父级必须有明确高度及 `min-h-0`，页面可使用 `h-full min-h-0 flex flex-col`。极小容器保留至少 6rem 数据区，外层应允许纵向滚动，确保工具栏和分页仍可到达；不能保证任意小容器同时完整显示所有操作。

数据区只有一个 `overflow-auto` 容器，同时负责横向与纵向滚动。工具栏、横向滚动按钮和分页位于其外。没有修改 `components/ui/` 原子组件。空态和骨架使用同一数据区；请求错误继续由业务页的 `QueryErrorState` 展示和重试，不创建第二套表格错误状态。

有界模式默认固定表头，可用 `stickyHeader: false` 关闭。整体 `thead` 固定在 top:0，多行分组标题以浏览器实际行高一起移动，无需逐行累计 top 偏移。已验证两层分组标题；没有新增横跨左右固定区的分组拆分能力，复杂跨区分组不作为本阶段支持承诺。表头、固定列、溢出边缘提示使用独立层级。

`mobileContent: true` 在小于 `md`（48rem）的屏幕上让 max-height 模式恢复自然高度并关闭固定表头，减少移动端嵌套纵向滚动。它不覆盖 fill 或全屏模式。

水平溢出时显示左右按钮和边缘阴影，滚到首尾分别禁用按钮、移除对应阴影。列显隐、调宽和容器尺寸变化重新计算溢出。

## 查询与位置恢复

| 操作 | 垂直位置 | 水平位置 |
| --- | --- | --- |
| 翻页、页大小、排序、过滤变化 | 回到顶部 | 保留并按有效范围限制 |
| 同一查询刷新数据 | 优先恢复首个可见行及相对偏移，行不存在时保留像素位置并限制范围 | 保留 |
| `viewKey` 变化 | 回到顶部 | 回到起点 |
| 进入/退出全屏 | 保留 | 保留 |
| 同一作用域卸载后重新挂载 | 可选恢复 | 可选恢复 |

- 服务端列表提供 `queryKey`，使用已提交查询和业务范围生成稳定字符串，避免直接使用防抖中的搜索文本。
- 占位数据/异步加载期间提供 `pending: true`，数据落地后再设为 false；旧数据不能提前触发位置恢复。
- 返回页面恢复使用 `restoreKey`，必须包含用户 ID、表格 ID 和必要的业务范围。缓存只在当前 JS 运行期存在，最多 30 项，不保存行对象、不写 localStorage，不跨页面刷新恢复。
- 返回时只有查询与视图一致才恢复垂直位置；调用方负责恢复自身查询状态。
- 配置稳定的 `getRowId` 才能可靠使用行锚点。

## 密度、文本和全屏

`layoutControls={{ density: true, fullscreen: true }}` 分别启用密度菜单和全屏按钮，默认不新增这些入口。

密度提供 `compact`、`standard`、`comfortable` 三档，通过现有 `tablePreference` 按用户/表格/schema 保存。旧偏好没有密度字段或值非法时采用 standard；“恢复默认”也重置密度。不配置 `tablePreference` 时只在当前组件内保持。触屏数据单元格按钮至少高 44px。

列定义支持：

```tsx
const columns: ColumnDef<Item>[] = [{
  accessorKey: 'description',
  header: '说明',
  size: 260,
  meta: { text: { mode: 'clamp', lines: 2, label: '说明全文' } },
}]
```

`mode` 可选 `truncate`（单行）、`wrap`（自然换行）、`clamp`（限行）。clamp 默认 3 行，限定 1–20 行。truncate/clamp 提供按钮打开完整内容浮层，支持点击、触摸、Enter、Escape 和焦点返回。纯字符串/数字值才进入该渲染；显式设置 `meta.text` 会替代这些值原有的 cell 显示，不应和交互式自定义渲染混用。其他列继续使用现有 renderer。

全屏使用应用内 Base UI Dialog，不调用浏览器 Fullscreen API。表格状态由原组件持有，进入/退出保留查询、分页、选择、布局偏好及位置。菜单先处理 Escape，关闭菜单后再次 Escape 退出全屏，焦点返回全屏入口。全屏开关会重建表格 DOM，因此自定义 cell 内部未提升的临时状态不保证保留；本阶段不包含行内编辑草稿。

## 接入示例

```tsx
<DataTable
  columns={columns}
  data={query.data?.items ?? []}
  getRowId={row => row.id}
  viewport={{
    mode: 'max-height',
    maxHeight: '60svh',
    mobileContent: true,
    queryKey: JSON.stringify(committedParams),
    pending: query.isPlaceholderData,
    restoreKey: `users:${currentUser.id}`,
  }}
  layoutControls={{ density: true, fullscreen: true }}
  tablePreference={{ userId: currentUser.id, tableId: 'users', schemaVersion: 1 }}
/>
```

| 页面 | 实际配置 |
| --- | --- |
| 用户列表 | max-height 60svh、移动自然高度、密度/全屏、用户隔离位置缓存 |
| 角色列表 | max-height 60svh、移动自然高度、密度/全屏、用户隔离位置缓存 |
| 部门成员 | max-height 50svh、移动自然高度、全屏、部门/子部门范围变化重置 |
| 权限树 | max-height 60svh、移动自然高度、全屏 |
| LDAP 配置 | max-height 55svh、移动自然高度、全屏 |
| LDAP 日志 | 88svh 弹窗内 fill、密度、异步分页数据落地后重置 |
| LDAP 预览 | 显式 content，沿用预览弹窗主滚动区 |

回退时移除 `viewport`、`layoutControls` 和列 `meta.text` 即恢复默认布局；原有分页、列固定、选择、工具栏 props 保持可用。M2 的保存视图、多列查询等能力仍未实施。
