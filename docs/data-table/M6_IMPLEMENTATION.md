# M6：页面接入与交付说明

2026-10-29，基于 M5 提交 `83269f1` 完成页面能力核对、剩余接入与兼容回归。

## 页面能力矩阵（实际实现）

| 页面 / 表格 | 数据与排序筛选范围 | 高度 / 布局 | 专项能力 | 选择与写入边界 |
| --- | --- | --- | --- | --- |
| 用户列表 | 服务端分页、搜索、组合筛选、多排序 | 60svh；移动端自然高度；密度、全屏、列布局 | URL、命名保存视图、列偏好、详情、当前页分组/汇总、昵称草稿、复制/CSV | 页/ID/查询范围选择；权限重查、批量状态、并发版本校验 |
| 角色列表 | 服务端分页和关键词；后端无排序契约，表头排序入口禁用 | 60svh；移动端自然高度；密度、全屏、列偏好 | 当前页统计，成员/授权对话框 | 权限按钮、内置角色限制、状态版本校验；无批量/查询保存视图 |
| 部门成员 | 服务端范围、含下级开关及分页；无服务端排序入口 | 50svh；移动端自然高度；全屏 | 部门切换、路径说明、占位数据提示 | 只读成员列表，切换范围不引入跨部门选择 |
| 权限完整树 | 完整已加载树；客户端搜索/树内排序；按根分页 | 60svh；移动端自然高度；全屏 | 树展开、业务管理操作 | 不启用平面表批量/行分组 |
| 权限按需树 | 服务端根分页、关键词及祖先保留；节点按需读取 | 60svh | 子节点缓存、失败重试、折叠取消 | 只读试点，服务端仍读取完整树后裁剪，非数据库虚拟化 |
| LDAP 配置 | 完整配置列表；客户端搜索/筛选/排序/分页 | 55svh；移动端自然高度；全屏、列偏好 | 刷新、预览与配置操作 | 按配置权限控制按钮，无批量修改 |
| LDAP 同步日志 | 服务端配置/状态范围及分页；无服务端排序入口 | 填满日志弹窗；密度、列偏好 | 只读查询、刷新、日志详情 | 不启用选择/导出/编辑；保持只读与同步执行边界 |
| LDAP 同步预览 | 服务端计划明细分页；搜索/筛选仅当前页 | **45svh 独立滚动**、固定表头 | **页大小 10/20/50/100 可切换、刷新当前页**；显示筛选口径 | 计划明细只读，执行前另行确认整个计划 |

所有现有业务页继续分页，未默认开启 M5 行虚拟化。角色、成员和日志没有对应的服务端多排序/组合查询 API，不展示假入口。命名查询视图目前仅用户列表启用；其他页面保存的列偏好不等于保存查询视图。

## 本轮代码修补

- LDAP 预览原来固定 `pageSize=50`，分页菜单选择其他值会被忽略。改为受控状态，把页大小与页码同步提交给已有计划明细接口，保持取消旧查询与缓存键隔离。
- 预览使用 45svh 数据区限高，工具栏/分页保留在数据区外；刷新调用当前明细查询，未重新生成计划。切页占位期间不保存错误的返回位置。
- 预览明确显示“搜索与筛选仅限当前页”，避免将客户端页内筛选误认成全计划搜索。
- 部门成员视口补传 `membersQuery.isPlaceholderData`，等待新范围数据就绪再恢复/重置滚动，避免旧范围占位数据覆盖位置。

## API、列与迁移

本轮无后端接口改动。正式查询/选择/导出契约见 [M2](M2_IMPLEMENTATION.md)、[M3](M3_IMPLEMENTATION.md)，详情/草稿/树节点见 [M4](M4_IMPLEMENTATION.md)。LDAP 复用既有 `ldapService.planItems(planID, page, pageSize, signal)`，只改变调用端状态绑定。

列必须保留稳定 ID。`meta.text` 控制 truncate/wrap/clamp；`meta.layout` 控制列操作能力；`meta.query` 声明查询字段；`meta.export` 与 `meta.edit` 只声明能力，调用端仍需权限、版本与服务端白名单校验。完整类型以 `src/components/data-table/types.ts` 为准。

```tsx
<DataTable
  columns={columns}
  data={query.data?.items ?? []}
  getRowId={item => item.id}
  serverFiltering
  serverPagination={{ pageIndex, pageSize, total, onChange: setPagination }}
  viewport={{ mode: "max-height", maxHeight: "50svh", pending: query.isPlaceholderData, queryKey: scope }}
  onRefresh={() => void query.refetch()}
  isRefreshing={query.isFetching}
/>
```

- 保留旧 `toolbarLeading`、旧 URL 参数和旧列偏好读取；不要在升级时清空用户存储。
- 列偏好按用户/表格/schema 隔离。新增列提供稳定 ID，删除列经白名单归一化；未知版本、存储拒绝访问/容量不足使用默认布局及可见提示，继续支持分页。
- 不提供 `advancedQuery`、受控选择、详情或 `virtualization` 即回退普通模式。旧分页调用仍可使用；服务端过滤页面未声明 `serverSorting` 时禁用排序。
- 虚拟化的开启条件、辅助技术分页替代及组合禁用见 [M5](M5_IMPLEMENTATION.md)。列虚拟化、团队共享视图、异步导出、自动保存、公式/透视仍未实施，不构成交付隐含能力。

## 复核路径

1. `frontend` 下运行 `npm test`、`npm run lint`、`npm run build`。
2. `PW_CHROME_CHANNEL=chrome npm run test:e2e` 验证页面、URL、视图、权限及旧 props。
3. `PW_CHROME_CHANNEL=chrome TABLE_VIRTUAL=1 npm run test:table-perf` 验证可选大列表模式。
4. 参照 [M6 验收记录](M6_VALIDATION.md) 区分 mock、历史真实接口与人工待补项目。
