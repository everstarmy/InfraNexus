# M2：列布局、高级查询与本地视图

日期：2026-10-28。用户已授权本阶段实施。验证证据见 [M2 验收记录](M2_VALIDATION.md)。本阶段以用户列表作为服务端查询和本地视图试点，其他页面保留已有查询入口。

## 实际接口与组件边界

- `data-table-preferences.ts`：列配置、读取、schema 校验和隔离存储键。
- `data-table-query.ts`：版本化查询、类型校验、分享 URL 编码及条件摘要。
- `data-table-query-editor.tsx`：条件组和排序编辑，提交前统一校验。
- `data-table-views.ts` / `data-table-views-menu.tsx`：命名视图格式及交互。
- `data-table.tsx`：组合上述能力，继续兼容原有分页、搜索、排序、工具栏和 M1 props。
- 用户页拥有已提交的查询和分页；服务端数据由 React Query 管理，旧请求通过既有 AbortSignal 取消。

```tsx
<DataTable
  layoutControls={{ columns: true, density: true, fullscreen: true }}
  tablePreference={{ userId, tableId: 'users', schemaVersion: 1 }}
  advancedQuery={{
    value: query,
    fields,
    onChange: applyQuery,
    onApplyView: applyView,
    initialLayout: defaultView?.layout,
  }}
  serverFiltering
  serverSorting={{ sorting, onChange: applySorting }}
  serverPagination={pagination}
  // 其余现有配置保持不变
/>
```

`advancedQuery` 是显式受控接口。组件不会自行对服务端分页结果执行高级过滤；调用方必须将条件发送到已实现该契约的服务端，并在 `onChange` / `onApplyView` 中一次更新查询和页码。高级查询和视图入口在搜索筛选行，密度、全屏、刷新、列设置仍在标题行，保持窄屏布局。

可选 `layoutState={{value, onChange}}` 让父级完全拥有布局。受控时组件不写本地布局偏好；视图应用、重置、列调整均通过该回调提交。

## 列管理与偏好

`layoutControls.columns` 启用列设置中的前移/后移、适配列宽和多列固定。未启用时保留原先每侧一个数据列的固定交互。

- 列顺序限定在同级分组内部；系统列以及 `meta.layout.move=false` 的列构成不可跨越边界。按钮可通过键盘操作。
- `meta.layout.pin=false` / `hide=false` 分别禁止固定和隐藏。原生 `enablePinning` / `enableHiding` 约束也会校验。
- 多列固定为中间区域预留 240px；不足时临时释放部分数据列，选择/操作列优先。窄屏不将临时降级写回保存偏好。
- 适配列宽只测量当前已加载的前 100 行标量访问值，每值最多 500 字符，并遵守 minSize/maxSize。它不是未加载服务端全量数据或复杂 React 单元格的精确宽度测量。
- 保存内容为 `density/columnVisibility/columnPinning/columnSizing/columnOrder`。新列按定义补入；删除列、无权限列、非法宽度和显隐状态按当前 schema 清理；始终至少保留一个数据列。
- 沿用用户/表格/schema 的原偏好键，旧数据缺少 columnOrder 或 density 时补默认值。不兼容 schemaVersion 使用新的键回退；不尝试猜测跨版本业务字段迁移。
- localStorage 禁用或配额失败时保留内存交互并显示提示。其他标签页更新布局后同步最新值并提示。

列 meta 当前提供文本规则、布局约束、查询字段类型声明，以及 `export: { enabled, label? }` / `edit: { enabled, input }` 能力声明。正式高级查询能力仍由 `advancedQuery.fields` 白名单明确授予，不能因为列可见就自动加入服务端查询；这些声明不自动创建入口或授予权限，导出和编辑行为留待 M3/M4 实现。

## 查询契约

用户列表的既有 `GET /api/v1/users` 增加可选 `query` 参数，其值为 JSON 字符串：

```json
{
  "version": 1,
  "search": "",
  "filter": {
    "logic": "and",
    "children": [
      { "field": "status", "op": "in", "value": [1, 2] },
      { "logic": "or", "children": [
        { "field": "last_login_at", "op": "empty" },
        { "field": "created_at", "op": "gte", "value": "2026-10-01T00:00:00+08:00" }
      ] }
    ]
  },
  "sorts": [
    { "field": "status", "desc": false },
    { "field": "created_at", "desc": true }
  ]
}
```

约束与语义：

| 类型/规则 | 支持范围 |
| --- | --- |
| 文本 | contains、eq、ne；最长 200 字符；通过数据库 LOWER 比较，LIKE 通配符按字面量转义 |
| 数字 | eq/ne/gt/gte/lt/lte/between，有限安全整数范围内的数值，不接受 NaN/Infinity |
| 枚举 | eq/ne/in，必须属于字段的允许值；in 为 1–50 项 |
| 布尔 | eq/ne，必须是 JSON boolean |
| 日期时间 | 比较和 between；要求 RFC3339 时区，统一到 UTC，范围含两端 |
| 空值 | nullable 字段使用 empty/notEmpty，对应 SQL NULL，不把空字符串等同于 NULL |
| 逻辑组 | and/or，最多 3 层、20 条叶条件；空组为真，UI 可清空条件 |
| 排序 | 最多 3 个不同字段，顺序即优先级；NULL 始终置后，最后附加 users.id ASC 稳定排序 |
| 大小限制 | 服务端原始 query 最多 8192 字节；无效字段、值、操作符、版本返回 HTTP 400/code 400001 |

用户白名单：username、nickname、email、status、auth_type、built_in、edit_revision、created_at、last_login_at。密码、Token、内部认证版本等不在白名单内。用户名/昵称/邮箱在前端被标记为敏感查询字段，允许当前页面查询，不允许写入本地视图或分享 URL。

不同数据库 Unicode LOWER/排序行为可能受数据库 locale 影响；当前明确验证的跨大小写文本行为是已有数据库 LOWER 规则，不承诺独立于数据库 locale 的全文检索。

高级查询与旧 keyword/status/auth_type/role_id/department 等范围使用 AND 组合，OR 仅作用在高级查询树内部。原有权限路由和软删除条件不变。query 存在时其 sorts 优先于旧 sort；没有 query 时继续旧接口行为。计数和分页查询使用同一条件树，先过滤再计数/排序/分页。SQL 标识符来自白名单，值绑定传入；非法字段在 Handler、Service、Repository 边界分别防御。

## 输入、URL 与视图恢复

用户页普通搜索仍使用 300ms 防抖；输入法组合期间只更新输入框草稿，compositionend 才提交。高级查询点击“应用”立即提交，页码同步归零；在新查询生效前调整页面状态，避免先请求旧页码。异步占位数据不能触发旧总数的越界页回退。

点击“生成查询链接”写入 `users_query`（内部 version=1）、`users_page`、`users_pageSize`，保留无关参数。公共编码器支持不同前缀；前进/后退重新读取当前前缀的有效状态。URL 页码为 1-based，组件内部为 0-based；页大小只接受 10/20/50/100。

- 分享 URL 拒绝敏感字段和非空自由搜索词，编码后最大 4000 字符，超限提供提示。
- 查询恢复顺序：父级受控值 → 有效 URL → 默认本地视图 → 页面默认。
- 页大小：父级受控值 → 有效 URL → 默认视图 → 页面默认。
- 布局：父级 layoutState → 默认/主动应用视图 → 用户表格偏好 → 列定义默认。
- 视图应用由父级回调一次提交查询和页大小，页码归零；M1 位置缓存按提交查询判断是否恢复。

本地视图支持另存为、覆盖、重命名、删除、默认视图及已修改提示。最多 20 个视图，名称不超过 50 字，重名拒绝。覆盖和删除使用项目 useConfirm，不使用原生 confirm。视图只保存 query/layout/pageSize，不保存页码、选择、行对象、草稿或滚动位置。

部门及角色是用户页当前业务范围，应用视图继续保留它们；状态和来源筛选会纳入视图查询，应用后以高级条件摘要展示。视图不是跨部门权限或业务范围切换工具。

视图存储键附在现有用户/表格/schema 键之后。写入前比较读取版本，发现其他标签页已改动时拒绝覆盖并要求重新打开面板。该检查能避免常见过期写入，但 localStorage 不提供原子 CAS，两个标签页恰好同时写入仍可能最后写入者获胜；不宣称具有数据库事务能力。损坏/不兼容视图可通过“重置本表保存视图”恢复；该操作需要确认。

## 回退与范围

移除 advancedQuery 与 columns 开关即可回退到原表格入口，后端不传 query 时保持旧列表语义。没有引入依赖、数据库迁移、云同步、团队共享、导出或行内编辑。PostgreSQL 环境未就绪时不能将 SQLite 结果当作双库验收；具体缺口见验收记录和任务清单。
