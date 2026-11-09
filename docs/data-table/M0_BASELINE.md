# M0：现状基线与页面接入矩阵

当前数据库支持范围为 PostgreSQL。下文涉及旧版文件数据库的结果是当时的验收记录。

日期：2026-10-27。源码基线：`e7046d08fb49ac9ff82f90f59efd80f4315c6e03`（main）。

开始 M0 时，已跟踪源码干净，只有上一轮新增的 `docs/data-table/` 未跟踪。此次仅修改测试基础设施和规划文档，不修改生产 DataTable、业务页面、后端接口或依赖锁文件。

关联：[M0 契约](M0_CONTRACTS.md) · [验收记录](M0_VALIDATION.md) · [任务清单](TODOLIST.md)。

## 1. 实际技术基线

- package.json 声明 `@tanstack/react-table ^9.2.4`，本机实际安装 **9.3.1**；后续以锁文件/安装版本而非声明下界决定 API。
- 现有 types.ts 使用 `tableFeatures`、`stockFeatures` 和各 row model；本机类型定义提供列顺序、列固定、列宽、排序、多排序、行选择与展开接口。
- 具体已核对：`setColumnOrder`、`toggleSorting(desc?, isMulti?)`、`enableMultiSort`、`enableRowSelection` 的行谓词、`resetExpanded`。
- 上游库有接口不代表 DataTable 已暴露：当前封装没有列顺序、逐行禁选、受控展开、命名视图、最大高度等公共配置；M0 不添加无行为实现的 props。
- 当前统一表格无受约束的内部纵向滚动；Table 原子组件仅设置 `overflow-x-auto`。页面或弹窗负责纵向滚动。
- 当前树配置 `paginateExpandedRows: false`、`filterFromLeafRows: true`；展开子节点不消耗根节点分页配额，叶子匹配可以保留祖先。

## 2. 页面矩阵

“列数”包含当前源码定义的操作列/选择列，不包含隐藏后减少的数量；行数为来源和页大小，不代表真实生产规模。M0 不读取生产数据。

| 表格 | 定义列数 / 默认隐藏 | 数据来源与页大小 | 查询/排序范围 | 父布局、操作与限制 |
|---|---|---|---|---|
| 用户 | 9（8 业务/操作 + 1 选择）；隐藏创建时间 | 服务端页，10 条 | 全量搜索、状态/来源/角色/部门；只发送排序数组第一个字段 | 12 列页面网格内 Card；新增/编辑/状态/角色/密码/删除/批量调岗受权限控制；两侧固定及调宽/偏好 |
| 角色 | 7；隐藏创建时间 | 服务端页，20 条 | 全量关键词；无自定义服务端排序 | Card；编辑、状态、授权、删除；固定/调宽/偏好；统计部分明确为本页 |
| 部门成员 | 4；无默认隐藏 | 复用用户接口，10 条 | 部门与含下级范围；无表格搜索或排序 | 12 列部门树+详情布局中的 Card；表格本身只读；左侧树滚动不是表体滚动 |
| 权限树 | 6；隐藏排序字段 | 全树返回，本地每页 50 根；默认全展开 | 客户端搜索/类型筛选/排序 | Card；新增子项/编辑/删除/路由同步；固定操作列；无服务器懒加载 |
| LDAP 配置 | 8；无默认隐藏 | 全部配置返回，本地每页 10 条 | 本地 identity 搜索与类型/登录等筛选 | 页面配置区；详情、编辑、登录开关、连接检测、预览/同步、删除依权限；无跨页批量 |
| LDAP 同步日志 | 7；无默认隐藏 | 服务端页，10 条 | config_id 服务端过滤；无表格搜索/自定义服务端排序 | 最大 88svh Dialog，内容 div 纵向滚动；详情操作、固定/调宽/偏好 |
| LDAP 预览明细 | 4；无默认隐藏 | 服务端页，固定 50 条 | 本页搜索/分面，placeholder 明确“当前页” | 最大 90svh Dialog，内容 div 滚动；运行同步是外围操作，不是行编辑；行 ID 含页内 index |

源码定位：

- [用户](../../frontend/src/pages/users/index.tsx)、[角色](../../frontend/src/pages/roles/index.tsx)、[部门成员](../../frontend/src/pages/departments/index.tsx)、[成员列](../../frontend/src/pages/departments/components/member-columns.tsx)
- [权限树](../../frontend/src/pages/permissions/index.tsx)、[LDAP 配置](../../frontend/src/pages/ldap/components/ldap-config-table.tsx)、[日志](../../frontend/src/pages/ldap/index.tsx)、[预览](../../frontend/src/pages/ldap/components/ldap-preview-dialog.tsx)

## 3. 当前接口与权限边界

路径均相对 `/api/v1`。此表是源码静态核对，不是数据库真实接口验收。

| 场景 | 已有接口/输入 | 排序与权限边界 | 后续缺口 |
|---|---|---|---|
| 用户/部门成员 | GET /users：page/page_size/keyword/status/auth_type/role_id/department_id/include_children/sort | username/nickname/email/status/created_at/last_login_at 白名单；单字段排序补 id ASC；前端参数取 sorting[0] | 高级表达式、多字段排序、全量选择/导出 |
| 角色 | GET /roles：page/page_size/keyword | built_in DESC、created_at ASC、id ASC 固定排序；页面 can 与服务端鉴权 | 筛选树、多排序、批量描述符 |
| 权限树 | GET /permissions，返回树 | 仓储 sort_order ASC、created_at ASC；客户端过滤；内置节点有操作限制 | 懒加载和服务端树查询需另定契约 |
| LDAP 配置 | GET /ldap/configs，返回数组 | created_at ASC；编辑/状态/同步等权限分开控制 | 无需为 M1 增加分页接口 |
| LDAP 日志 | GET /ldap/sync-logs：config_id/page/page_size | started_at DESC；现有接口没有多排序参数 | 复杂筛选/排序需要扩展接口 |
| LDAP 预览 | POST /ldap/preview；GET /ldap/sync-plans/:id/items：page/page_size | 计划明细查询传当前 actor.UserID；不是任意计划都可读取 | 稳定明细 ID、全量搜索、可变页大小需先统一契约 |

可复用的更新能力：用户更新/状态/部门使用 expected_revision；角色状态和权限分配使用 expected_revision；部门修改采用树 revision。现有用户 `batch-move-department` 传 user_ids、target_dept_id、expected_revision，不是通用 allMatching 批量接口。LDAP 同步已经使用 plan_id 和 idempotency_key；不能把它直接等同于通用导出任务系统。

依据：[用户 API](../../frontend/src/services/users.ts)、[角色 API](../../frontend/src/services/roles.ts)、[LDAP API](../../frontend/src/services/ldap.ts)、[用户仓储](../../backend/internal/repository/user_repository.go)、[角色仓储](../../backend/internal/repository/role_repository.go)、[LDAP Handler](../../backend/internal/handler/ldap_handler.go)。

## 4. 明确保留与后续改变

| 当前行为 | M0 处理 | 目标阶段 |
|---|---|---|
| 纵向随页面或弹窗滚动 | 保留，不给旧调用偷偷添加 max-height | M1 显式高度模式 |
| 当前每侧一个业务固定列 | 保留 | M2 宽度预算下多列固定 |
| 用户选择作用域是 JSON.stringify(params)，含页码和排序 | 保留，翻页/排序失效属于当前语义 | M3 跨页模式改为不含分页/排序的查询指纹 |
| persistRowSelection 可将 ID 写 URL | 保留旧行为，非新视图默认 | M2/M3 不将新选择模型写入 URL |
| 整表 selectionDisabled，未暴露逐行谓词 | 夹具仅验证整表禁选，不声称行级权限完工 | M3 行级不可选 |
| LDAP 预览仅本页搜索，ID 含 index | 如实记录，不在 M0 修改 | M2/M3 前先明确全量查询与稳定 ID |
| 查询错误由页面处理 | 夹具复用 QueryErrorState 与重试回调 | 后续统一协议仍允许页面所有权 |

## 5. 可复用测试夹具

目录：[frontend/e2e/fixtures/data-table](../../frontend/e2e/fixtures/data-table)。

- `data.ts`：稳定合成 ID，无随机数/当前时间；makeRows 与 scenarioRows 可独立复用。
- `render.ts`：使用实际 DataTable 和 QueryErrorState；树展开、分页、错误重试都由真实组件驱动。
- `mount.ts`：确认 /login 页面和标题，拦截 API，隐藏原 app root 后挂载独立测试根；每次重新导航销毁上次根与事件监听；未知接口返回 501，不访问真实后端。
- 新测试：[data-table-baseline.spec.ts](../../frontend/e2e/data-table-baseline.spec.ts)；现有工具栏测试已迁移使用同一 mount。
- 独立 TypeScript 配置：[tsconfig.table-fixtures.json](../../frontend/tsconfig.table-fixtures.json)，补足原项目 tsconfig 只检查 src 的覆盖空白。

| 场景 | 数据 | 验证用途 |
|---|---|---|
| short | 2 行 Alpha/Beta | 标题、工具栏、搜索基础 |
| many | 120 行，每页 10 | 12 页与末页定位 |
| wide | 2 行、21 列 | 水平溢出与最后列可达 |
| long-text | 2 行、长中文说明 | 溢出留在表格容器，移动端无页面横向溢出 |
| empty / loading | 0 行 | 空数据与加载骨架区分 |
| error | 主机先显示错误，重试成功后 2 行 | 错误不可误标为空数据；非网络接口集成测试 |
| tree | 1 根 + 3 子项 | 默认展开与收起/展开交互 |
| no-permission | 2 行 canEdit=false，整表禁选 | UI 禁用行为；不证明服务端权限安全或逐行选择 |

夹具不作为生产路由、不打包进应用入口；无新依赖。M1 改变滚动行为时应更新/新增目标断言，而不是为了保留旧基线阻止合理变化。

## 6. 阶段试点与交付决策

| 阶段 | 试点与必交项 | 暂缓或进入阶段后再决定 |
|---|---|---|
| M1 | 用户列表先行；滚动/固定表头/密度/文本/全屏；随后角色与弹窗验证 | 不改后端、不直接让每张表 fill |
| M2 | 用户高级查询；角色布局与本地命名视图；权限树保持根分页语义 | 云同步/共享视图暂缓；LDAP 预览全量查询先定契约 |
| M3 | 用户选择与调岗的既有业务作为试点，CSV 与可解释部分失败 | 不推导新增业务批量操作；异步任务由测量决定 |
| M4 | 权限树/用户详情展开；用户 nickname/email 编辑可复用更新版本校验 | 聚合先明确实际数值场景；自动保存、粘贴编辑暂缓 |
| M5 | 合成大行/宽列/树样本，先测量再优化 | 列虚拟化可据证据暂缓 |
| M6 | 汇总七张表实际能力、兼容回退与验证证据 | 不支持入口不展示 |

当前授权实施到 M0；以上是后续默认试点方案，完成 M0 不自动开始 M1。各阶段必交范围仍以强化清单和用户后续指令为准。
