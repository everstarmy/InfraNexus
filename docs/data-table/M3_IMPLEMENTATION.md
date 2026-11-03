# M3：选择、批量状态、CSV 与复制

> 历史阶段记录：当前选择失效、分页栏操作和导出入口已调整，最新行为以 [DataTable 使用手册](../../frontend/src/components/data-table/README.md) 及当前源码为准；本文保留当时的实施说明，不代表新增功能授权或最新验收。

日期：2026-10-28。试点为用户列表，基线提交 `fdde58b`。本阶段由用户明确授权实施；不扩展其他业务模块。

## 选择契约

通用 `TableSelection` 为 `{mode: "page" | "ids", ids: string[]}` 或 `{mode: "allMatching", excludedIds: string[]}`。`selectedOnPage` 投影当前页 checkbox；`updatePageSelection` 合并当前页变化，跨页模式保留未加载页 ID，全匹配模式只维护排除集合。两种集合各限 500 项，超限拒绝整次选择更新。

`DataTable.controlledSelection` 接受当前页 RowSelectionState 与 onChange；与旧 rows 型 batchActions 分离。旧页面无须迁移。`canSelectRow`、`rowSelectionDisabledReason` 支持行级不可选规则；selectionDisabled 用于占位数据和执行中阻止选择。旧批量调岗仍仅在 page 模式显示，避免把未加载行伪装成 rows。

用户列表 scope 包括身份 ID、有效权限、搜索、高级筛选、角色及部门范围，排除页码和排序。scope 改变立即使旧选择失效并提示，状态随后清空，返回旧查询不会复活选择。page 模式另外随页码/页大小变化清空；ids/allMatching 翻页与排序保留。选择不写 URL、视图或本地存储。

`allMatching` 的数量是列表 total 减排除数量的估计，不是快照；删除、并发修改及失效排除 ID 可使实际数量不同。服务端重新查询并过滤排除项，不以客户端计数或缓存权限授权。

## HTTP 接口及边界

均位于 `/api/v1/users`，通过既有 Cookie/JWT、Casbin 和请求中间件。

| 方法/路径 | 输入/输出 |
| --- | --- |
| POST `/batch-status/preview` | selection、status(1/2) → matched/eligible/skipped/items |
| POST `/batch-status` | selection、status、items:[{id,revision}] → success/failed/skipped/new_matches/items |
| POST `/export` | selection、fields → UTF-8 CSV，X-Export-Row-Count |

服务端 selection 使用 `excluded_ids`；query 是强类型对象，包含 `query`（M2 TableQuery）、keyword、statuses、auth_types、role_ids、department_id/no_department/include_children。所有范围与 IDs 取 AND 交集。未知查询字段、操作符沿用 M2 校验；非法选择模式、空 ID 集、重复 ID、零 UUID、过大集合均拒绝。

状态操作复用 `users:status` 权限并新增预检/执行 API 映射；新增 `users:export` 按钮权限。非管理员需明确授予导出权限。服务层要求列表权限和对应操作 API 权限；每条写入前重读操作者与授权，导出生成后再次鉴权。字段白名单独立于前端字段选项。

同步批量最多 200 条，导出最多 5000 条且 CSV 最多 8 MiB；服务处理期限 30 秒，前端请求超时 35 秒。不创建任务、持久文件或下载凭证。超限必须缩小范围；无自动拆分或后台重试。

## 预检、确认与重试

预检返回行版本及不可执行原因。当前账号/系统账号不能停用，已处于目标状态的记录跳过。前端明确确认目标状态、待处理数量和跳过原因，执行中按钮及勾选锁定；作用域切换或卸载后旧确认不能启动写入。

执行重新解析范围，只处理确认 items 与当前范围交集。新匹配且不在确认列表的记录计入 new_matches，不自动修改；已删除/已离开范围计入 skipped。逐项 CAS，允许部分成功。结果显示成功/失败/跳过及原因，成功和跳过项从选择中移除，保留失败 ID 并刷新列表。

幂等是“效果幂等”：记录已是目标状态则跳过，不递增 edit_revision/auth_version。陈旧版本且目标不同则冲突，必须刷新重新预检，不能用旧请求覆盖新修改。并非保证重复请求返回同一响应。可重试的临时写入错误标记 retryable；UI 只提交失败且可重试项，携带原版本，不重复提交成功项。

## 导出与复制

当前页、已选 ID、全部匹配均经服务器导出，避免当前页路径绕过下载权限。当前页是所展示 ID 与执行时查询交集，不是旧缓存内容的静态快照。字段按请求顺序输出，不跟随列隐藏状态；默认用户名、姓名、邮箱、状态。白名单：id、username、nickname、email、status、auth_type、domain、created_at、last_login_at、edit_revision。行顺序使用服务端查询排序及稳定 ID；用户试点导出不承诺保持当前视觉排序。

状态/身份来源输出中文展示值，日期为 UTC RFC3339Nano，NULL 为空字符串，版本为十进制字符串。CSV 使用 BOM、CRLF 和标准引号转义；公式前缀（含前导空白/控制字符）加单引号。超大整数须以字符串或 bigint 进入前端复制工具，拒绝不安全的整数 Number；CSV 的 int64 在服务端格式化，不经 JavaScript Number。

`enableCellCopy` 为可选开关，标量单元格提供复制入口；用户列表另有“复制已加载行 TSV”，范围仅当前加载页，按所选字段复制。TSV 转义引号、制表符、换行并防公式注入。Clipboard 不可用或被拒绝时显示错误，不降级为悄悄复制不完整内容。CSV/TSV 是文本交换格式，不承诺 Excel 自动推断后仍保留前导零等格式；没有 XLSX、跨页全量剪贴板、后台导出或持久下载。
