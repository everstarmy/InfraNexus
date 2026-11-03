# M0：状态与组件契约草案

日期：2026-10-27。状态：M0 设计决策，未接入生产 API。

关联：[现状与兼容边界](M0_BASELINE.md) · [总方案](ENHANCEMENT_PLAN.md)。

## 1. 契约如何进入代码

M0 不向 DataTableProps 添加尚无实现的字段。以下 TypeScript 是命名/语义草案，实施相应阶段时才增加生产类型、运行时校验、文档示例和测试。保留现有 `ColumnDef<TData, TValue>` 与 features 类型，不降级为 any 或绕过 TanStack v9 类型。

后续每个分组由一个状态所有者管理。受控值提供时必须同时提供 onChange，不再另存一份内部有效值；未受控才用 defaultValue。一个动作提交一次原子状态变更，React Query 的 key 使用规范化后的最终查询。

## 2. 高度、布局与试点配置（M1）

```ts
type ViewportDraft =
  | { mode: 'content'; maxHeight?: never }
  | { mode: 'max-height'; maxHeight: string | number }
  | { mode: 'fill'; maxHeight?: never }

type DensityDraft = 'compact' | 'standard' | 'comfortable'
```

数字 maxHeight 按 CSS 像素解释；字符串必须是可用 CSS 长度，不接受负数或无效值。max-height 约束数据视口（表头+表体），工具栏和分页不包含在内；fill 约束整个组件，父容器必须有可解析高度。

M1 默认试点：用户列表，桌面采用 max-height，候选 `60svh`；375/390px 移动端先保留 content。此值需经真实布局验证再固化，不作为跨页面硬编码常量。角色随后复用；LDAP 弹窗明确一层纵向滚动所有者后再选 fill，不能直接嵌套两个自动滚动区。

固定表头可用独立配置，但仅受约束模式默认开启；content 模式不承诺相对页面吸顶。普通刷新保留锚点，查询/排序/翻页重置纵向位置，切视图同时重置横向位置；尺寸变化仅裁剪到合法范围。

## 3. 查询与数据模式（M2）

用显式执行位置描述分页、筛选和排序，不用一个 server 布尔值掩盖混合行为：

```ts
type ExecutionDraft = 'client' | 'server'
interface DataModeDraft {
  pagination: ExecutionDraft
  filtering: ExecutionDraft
  sorting: ExecutionDraft
  // 对 server pagination + client filtering/sorting 必须明确只作用当前页。
  clientScope?: 'dataset' | 'page'
}
```

- 当前 LDAP 预览保留 `pagination=server/filtering=client/clientScope=page`，文案继续明确当前页。
- serverFiltering=true 且无 serverSorting 时维持“排序不可用”；新模型需显式列出排序能力，不能回退成只排当前页。
- 规范化查询内容为 search、filter tree、ordered sorts、固定业务 scope；分页单独管理，但同一次查询变化将 pageIndex 归零。
- 接口页码保持后端 1-based，组件内部保持 0-based，仅在适配层转换一次。
- 字段定义使用有类型的操作符/值联合，不让日期、数字、文本共享不受约束的 unknown 直接传服务端；运行时重新校验。
- 首版 AND/OR 深度最多 3、条件最多 20、排序最多 3；后端独立执行同样上限及字段白名单。
- 列 ID 不等于数据库列名；服务端映射查询键并使用绑定参数，权限条件始终与整体查询 AND 组合。
- 正式 HTTP body/编码由 M2 联调确定；M0 不新建端点或把草案作为既有服务器能力。

## 4. 受控状态、URL 与保存视图

恢复按状态片段合并，不能用一个存储对象粗暴覆盖全部状态：

| 状态 | 权威来源与恢复顺序 | 明确禁止 |
|---|---|---|
| 查询与排序 | 父级受控值 → 有效 URL 覆盖项 → 选定/默认视图 → 页面默认 | 同时由 URL 与内部 effect 双向反复写回 |
| 列布局/密度 | 父级受控值 → 选定视图 → 用户表格偏好 → 页面默认 | 把窄屏临时解除固定永久保存 |
| 页大小 | 父级受控值 → 有效 URL → 视图/偏好 → 页面默认 | 服务端能力不允许时仍显示可改变入口 |
| 页码 | 父级受控值 → 有效 URL → 0 | 保存到命名视图 |
| 选择 | 显式模式 + 当前身份/查询作用域 | 默认写入新 URL/视图 |
| 展开 | 父级受控值 → 同数据作用域下缓存 → defaultExpanded | 把旧树节点 ID 套到另一资源 |

例：URL 仅带关键词、没有列布局时，关键词覆盖默认视图查询，列布局仍取该视图；父级受控分页时，URL 页码不再驱动第二份分页状态。用户主动应用视图通过一个回调提交 query/layout/pageSize，并由父级决定接受后同步 URL。

命名视图至少含 version/userId/tableId/schemaVersion/name/query/layout/density；不含行对象、已选 ID、编辑草稿、令牌或敏感字段。权限变化按当前列 schema 白名单重建可用配置。损坏/超限存储回退默认并可理解提示，不阻止页面加载。

## 5. 选择与批量作用域（M3）

```ts
type SelectionDraft =
  | { mode: 'page'; ids: string[] }
  | { mode: 'ids'; ids: string[]; scopeKey: string }
  | { mode: 'allMatching'; query: NormalizedQueryDraft;
      excludedIds: string[]; scopeKey: string }
// NormalizedQueryDraft 在 M2 正式查询模型落地时定义，不能直接作为当前 API 请求。
```

新 scopeKey 包含资源类型、关键词/筛选、部门等业务范围和身份/权限版本；排除页码、页大小、排序、布局。它是缓存一致性标识，不是可信权限凭证。

旧用户页面 scopeKey 含分页和排序，M0 保持。新增模式显式启用后才采用新失效语义，避免改变现有批量调岗选中行为。

- page 模式兼容当前 rows 回调；ids/allMatching 使用独立执行描述符，不凭空合成未加载行。
- 全部匹配在执行时重查，预估数量不是执行保证；危险动作确认前预检，执行时再次校验。
- 行禁选是 UI 辅助；后端独立处理不存在、无权限、状态不允许等情况。
- 选择集合/排除集合上限在 M3 契约中明确；超限提示，不能静默截断。
- 部分成功与原子事务由业务操作声明；重试不能再次处理成功项。

## 6. 旧 API 兼容清单

| 当前公共接口 | 后续方向 | 迁移规则 |
|---|---|---|
| 无 viewport 参数 | 新增 viewport 分组 | 缺省 content，不自动改变旧页面滚动 |
| toolbarTitle / toolbarLeading | 保持 title，legacy alias | 两者同传时 title 优先，现有回归保留 |
| serverFiltering / serverSorting / serverPagination | data-mode + 受控 query | 旧组合兼容；新旧冲突不能静默猜测，开发阶段明确报错 |
| externalSearch / facetedFilters / dateRangeKey | 类型化 query/filter schema | 页面逐个迁移，旧搜索/重置仍工作 |
| enableColumnResizing / enableColumnPinning / initialColumn* | layout 分组 | 默认与旧版一致，响应式降级不回写 |
| tablePreference | 版本化 layout/views storage | 按用户/表格隔离，迁移失败可回退 |
| batchActions(rows, reset) | 保留 page；新增 descriptor callback | 未加载记录不传入 rows |
| selectionDisabled | 保留整表禁止；新增 canSelectRow | 业务/占位全局禁止优先于行谓词 |
| getSubRows / defaultExpanded | 保留；按需受控 expanded | 继续根节点分页与匹配祖先语义 |
| loading / isRefreshing / onRefresh | 后续状态分组或适配器 | 错误仍由页面可控，禁止把失败伪装为空 |
| onTableInstance | 暂保留高级 escape hatch | 新配置不要求页面直接改内部 table 状态 |

不在 M0 宣布旧参数废弃或删除。新增分组接口与兼容适配器应在对应阶段同时落地。

## 7. M0 验证边界

M0 夹具验证当前 public props、真实 DOM 交互、分页/横向滚动/错误宿主行为。它不验证未来 viewport API、不执行数据库请求、不验证真正权限安全、不证明百万级数据性能。基线缺口保持显式，后续任务按目标补测试。
