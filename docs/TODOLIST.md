# InfraNexus 工程交付与实施待办清单 (TODOLIST.md)

本清单用于追踪 **InfraNexus** 的工程交付。当前执行任务见下方 2026-10-22 看板，旧阶段记录保留供追溯，不作为本轮验收结论。

## 2026-10-22 当前实施看板：问题修复与前端交互改造

实施契约、文件范围、接口/迁移和验收矩阵见 [问题处理与前端交互改造方案](REMEDIATION_AND_UX_PLAN.md)。任务 ID 与方案一一对应，优先级不等于漏洞严重级别；全部初始为待实施，不因旧测试通过而自动勾选。

状态规则：`[ ]` 待处理；进行中在任务后写执行人/分支；`[x]` 必须附完成证据。证据至少包括变更、验证命令与结果、限制；需要浏览器/PG/双实例验证的任务不能仅凭编译或 SQLite 单测完成。

### M0：优先安全封堵

- [ ] **S01 / P0 字段授权与授予范围**
  - [ ] 通用用户更新移除 role_ids/status/department_id，旧敏感字段返回明确错误。
  - [ ] 创建初始角色/部门增加组合授权，前后端均对齐；新增单用户部门端点与种子权限。
  - [ ] 后端按 API 能力检查 AND 关系；admin 角色仅超管可授予，非超管授予不得超出自身有效 API 范围。
  - [ ] 角色授权、权限 Path/Method 改写同样检查最终权限，全部关联 ID 验证存在。
  - [ ] 验收：仅用户更新权限的账号不能自提权；创建、角色授权和权限修改旁路均拒绝。
- [ ] **S02 / P0 安全初始化**
  - [ ] 拆分种子与一次性管理员初始化，移除固定口令及口令日志。
  - [ ] 生产 JWT/目录密钥校验，开发演示与测试凭据显式注入。
  - [ ] 既有默认密码整改和改密撤销说明，重启不重置管理员。
  - [ ] 验收：空配置可操作失败、重启幂等、日志无凭据；新旧数据库演练。
- [ ] **S04-A / P0 SSE 最小授权封堵**（归属 S04）
  - [ ] 目录事件按订阅者读取权限过滤，不向所有登录账号广播。
  - [ ] 推送移除 DN/用户名/原始错误明细，日志详情通过受控查询获取。
  - [ ] 验收：无目录读取权限账号收不到目录事件与敏感载荷。
- [ ] **U01-A + U03-A / P0 授权弹窗安全保存**（归属 U01/U03）
  - [ ] 角色详情或权限树失败时显示重试并禁用保存；切角色不沿用旧选择。
  - [ ] 草稿只从成功读取初始化，后台刷新不覆盖正在编辑的选择。
  - [ ] 验收：模拟 403/500/断网不会发出空权限提交，也不会修改其他角色。

### M1：认证、数据语义与并发更新正确性

- [ ] **V01 / P1 版本化迁移与接口兼容基础**（须在结构变更落地前完成）
  - [ ] 迁移编号、字段回填、重复执行检测、新/存量数据库验证机制。
  - [ ] auth_version、edit_revision、组织/授权状态、Outbox、任务数据按对应里程碑渐进迁移。
  - [ ] 部门端点、树 revision、任务详情、错误码和权限种子的兼容契约。
  - [ ] 备份、凭据一次失效、禁止不兼容混跑、前向修复/功能关闭步骤。
- [ ] **S03 / P1 认证版本与旧凭据撤销**
  - [ ] 用户 auth_version、Session/Access/Refresh 版本签发及认证校验。
  - [ ] 停用/改密原子递增，启用不回退；LDAP 停用复用相同规则。
  - [ ] 更新前端启停/撤销文案，不承诺恢复旧会话。
  - [ ] 验收：Cookie/JWT/Refresh、同秒与并发撤销、旧格式升级均覆盖。
- [ ] **S07 / P1 错误、日志与追踪**
  - [ ] requestid.FromContext、统一无副作用错误分类、真实状态和内部原因记录。
  - [ ] GORM slog 适配与敏感参数脱敏；异步任务关联 task/operator/request ID。
  - [ ] 分类处理忽略错误，特别是会话偏好应用、认证存储和同步锁释放。
  - [ ] 验收：400/401/403/404/409/500/503 的响应/日志一致、request_id 可关联。
- [ ] **D01 / P1 清空与缺失字段语义**
  - [ ] 文本字段区分缺失与空值；单用户部门端点支持显式 null、拒绝缺失/空字符串。
  - [ ] 编辑资料与调岗入口解耦；服务类型、缓存失效与统计更新对齐。
  - [ ] 验收：清空真实生效，缺失不修改，失败不显示成功。
- [ ] **D02 / P1 角色服务端分页**
  - [ ] list 返回完整 PageData，查询键包含分页与筛选。
  - [ ] 接入 serverPagination/serverFiltering；统计明确全量/当前页口径。
  - [ ] 验收：150+ 角色均可访问，搜索/删除末页/刷新失败行为正确。
- [ ] **D03 / P1 用户复合写事务**
  - [ ] 创建用户和初始角色关联同事务，关联 ID 完整验证，错误不残留账号。
  - [ ] 唯一冲突与存储错误准确映射，保留内置管理员保护。
  - [ ] 验收：关联故障/非法角色/重复 ID/唯一冲突均有回归。
- [ ] **U04 / P1 并发安全乐观更新**
  - [ ] 查询接入 AbortSignal；目标行字段快照、按实体串行、局部回滚。
  - [ ] 列表/详情/统计缓存一致，账号切换忽略迟到响应。
  - [ ] 撤销作为新的受权请求，冲突和失败反馈准确。
  - [ ] 验收：A 行失败不覆盖 B 行成功；同实体连续操作不乱序。

### M2：数据库并发、策略收敛与实时通道

- [ ] **S05 / P1 部门结构与调岗一致性**
  - [ ] 领域 UnitOfWork、organization_state 锁/revision、SQLite/PG 仓储实现。
  - [ ] 创建/移动/删除/排序/LDAP 建部门/人员调岗接入同一事务协议。
  - [ ] 事务内循环、深度、唯一与删除保护，资料更新不覆盖结构字段。
  - [ ] 批量调岗完整校验、稳定锁顺序和影响行数不符回滚。
  - [ ] 树 revision/expected_revision/409 契约与有界忙等待处理。
  - [ ] 验收：双向移动、删除与调岗、LDAP 交错的 SQLite/PG 屏障并发测试。
- [ ] **S06 / P1 授权同事务提交与多实例一致性**
  - [ ] 角色关联、派生策略、授权 revision、Outbox 同事务，失败无半提交。
  - [ ] 请求核对 revision、本地稳定策略加载和失败关闭；禁止未提交时 Enforcer 自动保存。
  - [ ] 幂等 Outbox 消费、跨实例刷新通知、启动/断线补偿。
  - [ ] 验收：双实例中撤权后新请求均拒绝，消息丢失/加载失败/写故障有验证。
- [ ] **S08 / P1 路由权限防漂移**
  - [ ] 路由 public/auth-only/RBAC 显式分类及覆盖断言。
  - [ ] 同步报告新增/失效/重复/字段漂移，按 Method+模板核对。
  - [ ] 幂等同步走 S06，新增接口不自动授权，不自动删自定义权限。
  - [ ] 验收：连续同步、路由变更、权限 Path 改写和并发同步回归。
- [ ] **S04-B / P1-P2 SSE 生命周期与恢复**（完成后汇总 S04）
  - [ ] Hub 独立基础设施实现、领域订阅接口、身份/会话绑定与取消。
  - [ ] 投递授权、会话/版本撤销、非续期周期验证、跨实例信号。
  - [ ] 有界队列、事件 ID/保留窗口、Last-Event-ID、溢出快照恢复。
  - [ ] 前端身份探测、退避重连、通知/查询缓存清理与 generation 隔离。
  - [ ] 验收：注销、到期、撤权、账号切换、跨实例重连及迟到事件安全。

### M3：可靠前端基础与可访问性

- [ ] **U01 / P1 查询状态全面接入**
  - [ ] QueryState 区分首次加载/错误/403/空数据/后台失败，覆盖六个页面和详情浮层。
  - [ ] keepPreviousData 标注占位期，禁用依赖旧集合的批量操作。
  - [ ] Dashboard 不以 0 伪装失败，提供更新时刻与重试。
  - [ ] 验收：失败/空结果组件测试及浏览器断网恢复；包含 U01-A。
- [ ] **U02 / P1 草稿与离开保护**
  - [ ] Data Router 迁移，保持权限、懒加载、重定向和滚动行为。
  - [ ] 统一 dirty 快照、Dialog/Sheet 关闭、路由 blocker、beforeunload。
  - [ ] 保存中/保存失败/成功重置及确认队列，敏感草稿不持久化。
  - [ ] 验收：Esc/遮罩/取消/侧栏/命令/后退/刷新均不静默丢稿，无焦点循环。
- [ ] **U03 / P1 权限差异配置**
  - [ ] 完整树计算三态，搜索结果操作与模块全选明确区分。
  - [ ] 后代索引、差异清单、增强清空确认、无变更禁提交。
  - [ ] 角色 revision 冲突保留草稿并提供对比/重新加载。
  - [ ] 验收：隐藏节点不误改、双管理员冲突/授予范围/查询失败正确；包含 U03-A。
- [ ] **U09 / P1-P2 动效、通知与无障碍基础**
  - [ ] motion-safe/reduced-motion、语义样式、shimmer 与短暂徽章反馈。
  - [ ] 浮层全状态标题、焦点恢复、图标名称、表单错误关联和适量 aria-live。
  - [ ] 显式已读、重连气泡与恢复提示，声音/桌面通知按用户主动授权启用。
  - [ ] 验收：纯键盘、读屏抽查、亮暗/减少动态效果/移动端记录。

### M4：高频管理效率

- [ ] **U05 / P2 表格交互增强**
  - [ ] 吸底批量栏与安全区，默认当页选择；换页/筛选清空规则明确。
  - [ ] UUID 锚点 Shift 范围选择，排序/分页/占位数据不误选。
  - [ ] v9 列宽受控、键盘调整与重置，可配置固定列及正确偏移。
  - [ ] 按用户/表格/schema 隔离偏好，低风险字段行内编辑和冲突反馈。
  - [ ] 验收：实际批量 ID 准确、固定列无重叠、移动端不遮挡；虚拟化另过性能门槛。
- [ ] **U06 / P1-P2 部门树增强**
  - [ ] roving tabindex、方向键/Home/End/Enter、搜索高亮和结果定位。
  - [ ] 拖拽 before/after/inside、目标与影响预览、触摸/键盘替代。
  - [ ] expected_revision、409 重载与失败恢复，移动后展开/聚焦正确节点。
  - [ ] 验收：S05 通过后开启 DnD，纯键盘全流程与结构冲突浏览器验证。
- [ ] **U08 / P2 命令面板扩展**
  - [ ] 从 Header 抽离命令注册，接入快捷创建、实体搜索和最近访问。
  - [ ] 使用现有 API 权限码，至少 2 字/300ms 防抖/取消查询/结果限制。
  - [ ] 全局/页面/模态框快捷键作用域，处理 `/` 冲突、输入法与焦点恢复。
  - [ ] 验收：未授权无请求、旧结果不覆盖新结果、命令跳转遵循 dirty guard。

### M5：LDAP 可恢复任务体验

- [ ] **U07 / P2 同步向导、计划与 Diff**
  - [ ] 检查→预览→确认→执行→结果，现有立即同步不绕过高风险确认。
  - [ ] plan_id/有效期/配置与记录版本/目录指纹、分页字段 Before/After。
  - [ ] 执行重新校验、409 重审、幂等请求、逐用户 CAS 与部分失败说明。
  - [ ] 任务详情受控端点、持久化快照、lease/owner 心跳及丢租约停止写入。
  - [ ] 分阶段真实进度与正确分母、推送节流、终态可靠发布和重连恢复。
  - [ ] 敏感计划/事件清理、旧客户端事件兼容、失败项重新计划。
  - [ ] 验收：计划过期/变化/重复点击/中断/断线/越权/部分失败测试与浏览器流程。

### M6：最终验证与发布准备

- [ ] **V02 / P1-P2 后端完整矩阵**：越权、撤销、事务故障、树并发、双实例策略、SSE、LDAP 与日志矩阵；真实 SQLite/PG/Redis 证据。
- [ ] **V03 / P1-P2 前端与浏览器矩阵**：必要组件/E2E 工具接入；六模块失败状态、表单防丢、表格/树/命令/任务流程；四档视口、亮暗/减少动态效果与键盘。
- [ ] **V04 / P2 性能与发布记录**：固定环境基线、bundle/长任务/请求负载采样；升级/凭据失效/回退开关演练；README/API/架构与测试命令同步。
- [ ] **P3 可选能力门槛**：长树/长预览确有性能问题时评估虚拟化；跨页选择另立契约。未实施不宣称能力已具备，也不阻塞安全修复发布。

### 完成证据登记模板

```text
任务 ID：
执行人 / 分支 / 关联提交或 PR：
变更与行为：
验证命令、环境与结果：
浏览器 / 双数据库 / 双实例证据（适用）：
迁移、兼容与回退影响：
未覆盖与后续项：
```

## 历史交付记录（以下不作为本轮重新验收结果）

---

## 阶段一：项目工程骨架与基建初始化 (Phase 1: Foundation Setup)
- [x] **1.1 根目录与双工程结构初始化**
  - [x] 创建 `backend/` 与 `frontend/` 目录
  - [x] 后端初始化 `go.mod` (Go 1.27+, Module: `infranexus`)
  - [x] 前端使用 Vite 8 + React 19 + TypeScript 初始化工程
  - [x] 根目录配置统一的 `.gitignore` 与开发启动快捷命令 (`Makefile` 或 `package.json` scripts)
- [x] **1.2 后端核心基建搭设**
  - [x] 集成 `viper` 配置中心 (`internal/config/config.go`，解析 `config.yaml` 及环境变量)
  - [x] 集成 `log/slog` 结构化日志工具封装 (`internal/core/logger/logger.go`)
  - [x] 集成 GORM 双引擎初始化器 (`internal/bootstrap/database.go`)，支持 SQLite 与 PostgreSQL 自动无缝切换与连接池配置
  - [x] 引入 `gorm.io/datatypes` 并支持 `datatypes.JSONType[T]` 泛型 JSONB 字段
  - [x] 集成 Redis 客户端初始化器 (`internal/bootstrap/redis.go`)
  - [x] 封装 Fiber Storage 统一驱动工厂 (`internal/storage/factory.go`，支持 `memory`, `sqlite3`, `postgres`, `redis`, `s3`)
  - [x] 封装与领域业务状态码强绑定的泛型统一响应格式 (`internal/core/response/response.go`：`Success[T]`, `Page[T]`, `Error` + 业务状态码常量如 `CodeSuccess=200000`, `CodeTokenExpired=401001` 等)
  - [x] 封装请求验证器 (`internal/core/validator/validator.go` 基于 `go-playground/validator`)
  - [x] 封装全局错误拦截器 (`internal/core/errors/` 与 Fiber `ErrorHandler`)

---

## 阶段二：GoFiber v3 中间件流水线、认证双通道与泛型仓储 (Phase 2: Backend Core & Auth)
- [x] **2.1 中间件管线集成**
  - [x] 集成 `gofiber/middleware/recover`
  - [x] 集成 `gofiber/middleware/requestid` (透传与注入 Context)
  - [x] 集成 `gofiber/middleware/responsetime`
  - [x] 集成 `gofiber/middleware/cors` (支持自定义 AllowedOrigins 与 Credentials 跨域 Cookie 携带)
  - [x] 集成 `gofiber/middleware/logger` (与 slog 桥接输出带 RequestID 的日志)
  - [x] 集成 `gofiber/middleware/sse` (构建实时长连接通知端点)
  - [x] 构建**双通道认证中间件**：Web 端优先解析 HttpOnly Session Cookie (并自动执行滑动窗口延期)；第三方/开放接口优先解析 Header `Authorization: Bearer <JWT>`
  - [x] 集成 `gofiber/contrib/casbin` (基于 RBAC 规则拦截 API 资源)
- [x] **2.2 核心领域实体与泛型三层解耦接口设计 (全表 UUID 主键与 JSONB)**
  - [x] `domain/base.go`: `BaseEntity` 全局嵌入 UUID 主键（结合 Go 1.27+ 自带/标准 UUID 库并提供 `BeforeCreate` 自动发号）与 `Repository[T any, ID comparable]` 泛型仓储基类接口
  - [x] `domain/user.go`: 用户模型（包含 UUID 主键、`datatypes.JSONType[UserPreferences]`、多对多 `sys_user_roles` UUID 外键）、`UserRepository` 与 `UserService` 接口
  - [x] `domain/role.go`: 角色与 Casbin 模型定义（UUID 主键）、`RoleRepository` 与 `RoleService` 接口
  - [x] `domain/permission.go`: 权限菜单树与操作点实体定义（UUID 主键）
- [x] **2.3 Repository 持久化层实现**
  - [x] `repository/user_repository.go`: 基于泛型 GORM 的 CRUD 与角色关联查询
  - [x] `repository/role_repository.go`: 角色持久化与关联 Casbin 策略规则写入
  - [x] `repository/permission_repository.go`: 权限与菜单树查询
- [x] **2.4 Service 业务逻辑层实现**
  - [x] `service/auth_service.go`: 密码哈希、Session 会话创建与 Redis 缓存、JWT Token 颁发、登出与黑名单销毁
  - [x] `service/user_service.go`: 用户注册/创建、修改、偏好设置更新、启停、分派角色
  - [x] `service/role_service.go`: 角色维护与权限矩阵绑定
- [x] **2.5 Handler HTTP 接入层实现与路由挂载**
  - [x] `handler/auth_handler.go`: 登录、登出、会话状态检测、Token 颁发
  - [x] `handler/user_handler.go`: 用户分页列表、创建、修改、删除、状态切换
  - [x] `handler/role_handler.go`: 角色列表与权限分配
  - [x] `handler/sse_handler.go`: SSE 客户端连接与事件广播通道
  - [x] 精简 `cmd/server/main.go`，通过装配器注入各层依赖并启动 HTTP 监听

---

## 阶段三：前端全宽 SaaS 布局、Base UI 网格与组件集成 (Phase 3: Frontend Layout & Data-Table)
- [x] **3.1 前端样式与 UI 基础搭建**
  - [x] 安装并配置 Tailwind CSS v4 与 CSS 变量主题系统 (暗黑/明亮无感切换)
  - [x] 安装 `@base-ui/react`, `@shadcn/react`, `lucide-react`, `clsx`, `tailwind-merge` 等核心原子包
  - [x] 基于 `@base-ui/react` 封装通用原子组件 (Button, Input, DropdownMenu, Dialog, Badge, Sheet 等)
  - [x] 确立 12 列响应式代码网格规则 (`grid grid-cols-12 gap-4 md:gap-6`)
- [x] **3.2 企业级数据表格深度整合**
  - [x] 将 `@[/Users/liangyx/Documents/GoProject/storage-net/frontend/src/components/data-table]` 完整引入并适配：
    - [x] `data-table.tsx`
    - [x] `data-table-column-header.tsx`
    - [x] `data-table-pagination.tsx`
    - [x] `data-table-toolbar.tsx`
    - [x] `data-table-faceted-filter.tsx`
    - [x] `data-table-date-range-filter.tsx`
    - [x] `data-table-view-options.tsx`
    - [x] `data-table-skeleton.tsx`
    - [x] `data-table-empty.tsx`
    - [x] `types.ts` & `index.ts`
- [x] **3.3 SaaS 管理后台流式全宽布局设计**
  - [x] 顶部导航区 (`Header`): 面包屑、全局搜索 (`Cmd+K`)、主题切换、用户下拉头像
  - [x] 侧边栏导航 (`Sidebar`): 桌面端可折叠 (展开/紧凑 Mini 模式)、移动端抽屉式滑动唤出
  - [x] 主画布区域 (`Main`): 全宽度流式自适应 (`w-full min-h-screen`)，在大屏 (2K/4K) 上铺满展开，杜绝居中收窄限制

---

## 阶段四：前端业务模块与交互闭环 (Phase 4: Frontend Business & Auth Flow)
- [x] **4.1 网络请求与无感刷新拦截器**
  - [x] 封装 Axios 实例 (`src/services/api.ts`)
  - [x] 实现 401 拦截无感刷新 AccessToken + 挂起请求队列 (Failed Queue) 重放机制
  - [x] 实现客户端 Auth Store 与本地持久化记录当前登录用户及权限列表
- [x] **4.2 核心业务页面实现**
  - [x] 登录页面 (`pages/auth/login.tsx`): 现代化 SaaS 设计、表单校验、登录成功跳转
  - [x] 控制台概览页 (`pages/dashboard/index.tsx`): 状态指标与实时系统图表展示
  - [x] 用户管理页 (`pages/users/index.tsx`):
    - [x] 接入 `DataTable` 组件，支持分页、排序、状态筛选、角色筛选
    - [x] 新建/编辑用户弹窗 (Dialog) 与状态开关切换
  - [x] 角色管理页 (`pages/roles/index.tsx`):
    - [x] 角色列表与新建/编辑
    - [x] 角色权限树状勾选面板 (树状复选框分配菜单与操作权限)
  - [x] 权限管理页 (`pages/permissions/index.tsx`): 菜单与 API 资源结构展示
  - [x] SSE 实时消息接收监听：在顶部通知中心实时呈现后端推送的事件通知

---

## 阶段五：联调、验证与脚手架工程交付 (Phase 5: Verification & Delivery)
- [x] **5.1 数据库双引擎验证**
  - [x] 验证 SQLite 驱动下一键启动生成数据文件与初始化管理员账号
  - [x] 验证 PostgreSQL 驱动配置连接并在启动时成功执行自动迁移 (AutoMigrate)
- [x] **5.2 认证与权限全链路测试**
  - [x] 验证登录签发双 Token、登出 Token 黑名单失效机制
  - [x] 验证 AccessToken 过期后，前端静默完成 Token 刷新，用户操作无感延期
  - [x] 验证 Casbin RBAC 中间件对于非授权角色的 403 阻断行为
- [x] **5.3 响应式全宽测试**
  - [x] 验证在超宽屏 (≥1920px) 下，数据表格与主面板全宽度自适应展开
  - [x] 验证在移动端 (<768px) 下，侧边栏抽屉折叠、移动端手势与表格横向平滑滚动
- [x] **5.4 编写快速启动与部署文档**
  - [x] 编写根目录 `README.md`，提供一键初始化与开发启动命令指引

---

## 优先整改（2026-10-20）

历史实施契约见 [具体实施方案](PRIORITY_REMEDIATION_PLAN.md)。以下勾选是旧轮次记录；2026-10-22 的执行状态以本文顶部看板为准。

- [ ] P0.1 分离 Web Session 登录与外部 JWT Token 端点，移除登录 JSON 中的会话凭据。
- [ ] P0.2 严格 Bearer 优先且失败不回退；校验 JWT 用途、issuer、期限、撤销。
- [ ] P0.3 刷新令牌原子轮换、防重放；退出撤销当前令牌族。
- [ ] P0.4 Session 空闲/绝对过期、Cookie 同步续期、重新登录替换旧会话。
- [ ] P0.5 当前用户状态/角色校验，CSRF/CORS 来源配置与登录限流。
- [ ] P0.6 认证接口进入 domain，状态存储进入 repository，移除认证 Handler 越层访问。
- [ ] P0.7 前端纯 Cookie 认证、移除本地 Token/刷新队列、身份恢复和错误处理。
- [ ] P1.1 统一业务码 HHHCCC，修订三个主文档、README 与过时示例。
- [ ] P1.2 后端认证回归、并发与存储异常验证；前端构建与认证流程验证。
- [ ] P1.3 记录实际验证命令、结果和未覆盖事项。
- [ ] P2 版本化迁移、双数据库契约测试、生产初始化与跨实例一致性（后续）。
- [ ] P3 CI、审计、监控、恢复、性能基线及按需多租户（后续）。

---

## 企业组织与目录集成（2026-10-21）

分支 `feat/enterprise-org-ldap`，按 Step 1–6 分次提交。以下勾选均有本轮测试或浏览器验收证据。

- [x] Step 1 缺陷修复：请求校验绕过、角色筛选 500、软删除后用户名/邮箱/编码无法复用（改为部分唯一索引并迁移旧索引）、权限树丢失子节点。
- [x] 部门树：TreePath 物化路径（≤15 级）、负责人/排序/移动、子部门与成员删除保护。
- [x] 用户部门关联：部门筛选（可含下级）、`POST /api/v1/users/batch-move-department` 事务化批量调岗。
- [x] AD/LDAP：配置（绑定密码 AES-GCM 加密）、连接测试、同步预览、手动全量/增量同步与定时全量同步、OU/属性映射部门、同步日志与 SSE 通知。
- [x] 多源域认证：登录携带 `domain`，用户 DN 绑定校验、JIT 建档、失败统一 `401002 域认证账号或密码错误`。
- [x] 用户/角色/权限补全：重置密码与会话撤销、多角色、内置保护、角色授权面板、成员列表、权限点 CRUD、路由同步至 Casbin、前端按钮/页面级权限。
- [x] UI/UX：AlertDialog 二次确认 + Toast、统计卡片、来源徽标、状态开关、空状态与骨架屏；亮/暗色、1440/2560 宽屏、移动端浏览器验收。
- [x] 验证：`go vet ./...`、`go test -count=1 ./...`、`go test -race ./...`（49 个测试函数）、`npm --prefix frontend run build`、`npm --prefix frontend test`（16 项）全部通过。

已知限制：
- [ ] Casbin 鉴权中间件为 contrib 同形自研实现：`gofiber/contrib/casbin` 依赖 casbin/v2，与本项目 casbin/v3 不兼容。
- [ ] 策略修改只刷新当前进程的 Enforcer，多实例需重启或另行实现策略广播（同 P2「权限策略跨实例一致性」）。
- [ ] 本轮自动化测试与验收只覆盖 SQLite，PostgreSQL 未验证。
