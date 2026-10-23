# InfraNexus AI 智能体开发规范与协作指南 (AGENTS.md)

本指南供所有参与 **InfraNexus** 项目研发的 AI 智能体（Agents）和工程师遵循。修改或扩展本代码库时必须严格遵循以下约定。

---

## 1. 目录结构规范 (Project Layout)

项目采用现代前后端分离 monorepo/双目录结构：

```
InfraNexus/
├── backend/                        # Go 后端工程
│   ├── cmd/
│   │   └── server/
│   │       └── main.go             # 薄入口，仅负责配置加载、依赖注入组装与平滑启停
│   ├── internal/
│   │   ├── config/                 # Viper 配置映射结构体与加载器
│   │   ├── core/                   # 核心通用设施 (logger, response, errors, validator)
│   │   │   ├── errors/             # 领域错误定义与 HTTP 映射
│   │   │   ├── logger/             # slog 结构化日志包装器
│   │   │   ├── response/           # 统一 JSON 包装工具函数 (Success, Error, Page)
│   │   │   └── validator/          # gofiber 验证器包装
│   │   ├── domain/                 # 核心领域实体与接口定义 (解耦边界)
│   │   │   ├── user.go             # 用户实体与 UserRepository / UserService 接口
│   │   │   ├── role.go             # 角色实体与 RoleRepository / RoleService 接口
│   │   │   └── permission.go       # 权限实体与接口
│   │   ├── handler/                # HTTP 接入层 (Fiber v3 c fiber.Ctx)
│   │   │   ├── auth_handler.go
│   │   │   ├── user_handler.go
│   │   │   ├── role_handler.go
│   │   │   └── sse_handler.go
│   │   ├── service/                # 业务逻辑层 (事务、规则计算、密码散列)
│   │   │   ├── auth_service.go
│   │   │   ├── user_service.go
│   │   │   └── role_service.go
│   │   ├── repository/             # 数据持久化层 (GORM 数据库查询 + Redis 缓存)
│   │   │   ├── user_repository.go
│   │   │   ├── role_repository.go
│   │   │   └── casbin_repository.go
│   │   ├── middleware/             # 认证、鉴权、全局拦截器
│   │   │   ├── auth_jwt.go         # gofiber/contrib/jwt 适配
│   │   │   ├── casbin.go           # contrib 同形 Casbin 中间件（casbin/v3 SyncedEnforcer；gofiber/contrib/casbin 依赖 casbin/v2，不可混用）
│   │   │   ├── request_log.go      # 请求链路日志与 RequestID 关联
│   │   │   └── error_handler.go    # 全局异常捕获与格式化转换
│   │   ├── storage/                # Fiber Storage 统一驱动工厂
│   │   │   └── storage.go          # 支持 memory, sqlite3, postgres, redis, s3
│   │   └── bootstrap/              # 启动装配器 (wire/ioc 接口装配)
│   │       ├── database.go         # GORM 双驱动初始化 (SQLite / Postgres)
│   │       ├── redis.go            # Redis 客户端初始化
│   │       └── casbin.go           # Casbin Enforcer 初始化
│   ├── config.yaml                 # 默认配置文件
│   ├── go.mod
│   └── go.sum
├── frontend/                       # React 19 + Vite 前端工程
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/             # 通用基础与业务组件
│   │   │   ├── ui/                 # shadcn / base-ui 原子组件 (Button, Input, Dialog 等)
│   │   │   └── data-table/         # 深度复用的企业级数据表格 (TanStack Table v9)
│   │   │       ├── data-table.tsx
│   │   │       ├── data-table-column-header.tsx
│   │   │       ├── data-table-pagination.tsx
│   │   │       ├── data-table-toolbar.tsx
│   │   │       ├── data-table-faceted-filter.tsx
│   │   │       ├── data-table-date-range-filter.tsx
│   │   │       ├── data-table-view-options.tsx
│   │   │       ├── data-table-skeleton.tsx
│   │   │       ├── data-table-empty.tsx
│   │   │       ├── types.ts
│   │   │       └── index.ts
│   │   ├── layouts/                # SaaS 工作台布局 (Sidebar, Header, Full-width Main)
│   │   ├── pages/                  # 业务路由页面
│   │   │   ├── auth/login.tsx
│   │   │   ├── dashboard/index.tsx
│   │   │   ├── users/index.tsx
│   │   │   ├── roles/index.tsx
│   │   │   └── permissions/index.tsx
│   │   ├── services/               # API 接口层与 Axios 实例 (Cookie 会话请求)
│   │   │   ├── api.ts              # Axios 实例与 Request/Response 拦截器
│   │   │   ├── auth.ts
│   │   │   └── users.ts
│   │   ├── stores/                 # 客户端状态管理 (Zustand 或 Context)
│   │   │   └── use-auth-store.ts
│   │   ├── types/                  # 全局 TypeScript 类型声明
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css               # Tailwind CSS v4 入口
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── REQUIREMENTS.md                 # 需求规格说明书
├── AGENTS.md                       # 本协作规范
├── ARCHITECTURE_AND_PLAN.md        # 具体架构与实现方案
└── TODOLIST.md                     # 开发任务追踪看板
```

---

## 2. 后端编码规范 (Go 1.27+ / Fiber v3)

### 2.1 语言版本与泛型深度支持 (Go 1.27+)
- 全面使用 Go 1.27+ 现代泛型语法，实现类型安全的基类抽象：
  - **泛型 Repository 基类**：在持久化层提供 `Repository[T any, ID comparable]`，提供通用的 `GetByID`, `List`, `Create`, `Update`, `Delete` 泛型实现。
  - **泛型 JSONB 字段**：使用 `gorm.io/datatypes.JSONType[T]` 强类型绑定配置、偏好与元数据，免除传统手动序列化与 `interface{}` 断言。
  - **泛型响应包装器**：`response.Success[T any](c fiber.Ctx, data T)` 与 `response.Page[T any](c fiber.Ctx, items []T, total int64, page, pageSize int)`。

### 2.2 严格的三层架构与接口注入 (Interface Injection)
- **禁止交叉越级调用**：`Handler` 只能调用 `Service`；`Service` 只能调用 `Repository` 或其他 `Service`；`Repository` 只负责底层数据库与缓存存取。
- **面向接口编程**：在 `internal/domain` 中声明所有接口（例如 `UserService`, `UserRepository`），实现类只暴露工厂函数（如 `NewUserService(repo domain.UserRepository) domain.UserService`），便于单测 Mock。
- **保持 `main.go` 极其精简**：`main.go` 只做：1) 读取配置；2) 初始化底层资源（DB, Redis, Logger）；3) 调用装配模块；4) 注册中间件与路由；5) 启动服务并监听 `os.Interrupt` / `SIGTERM` 平滑关闭。

### 2.3 GoFiber v3 规范要点
- **导入路径**：必须使用 `github.com/gofiber/fiber/v3`，而不是 v2。
- **Context 规范**：使用 `c fiber.Ctx`。处理 JSON 解析时使用 `c.Bind().JSON(&req)` 或 `c.Bind().Body(&req)`。
- **中间件扩展**：
  - 必须挂载 `requestid`，并在日志和响应中输出。
  - 必须挂载统一的 `ErrorHandler`，返回结构体必须符合统一响应模型。
- **日志记录规则**：
  - 统一使用注入的标准库 `*slog.Logger`，请求相关日志使用 `InfoContext/WarnContext/ErrorContext`；详细约定见下方 2.7。
  - HTTP 边界使用 `requestid.FromContext(c)`，通过 `requestmeta` 桥接到标准 Context，由日志 Handler 自动提取关联字段。
  - **严禁使用 `fmt.Println` 或 `log.Fatal` 直接输出业务信息**。

### 2.4 统一响应与业务状态码挂钩规范 (Business-Linked Response)
业务码规则为 `HHHCCC`（HTTP 三位状态码 + 三位业务细分）。Handler 中禁止散乱构造 map，必须使用 `response` 包的标准函数，并且**业务状态码 `code` 必须与领域错误强挂钩**：
```go
// 业务状态码示例：
// 200000 = Success
// 400001 = 参数校验未通过
// 401001 = Token/Session 已过期
// 403001 = 角色权限不足 (Casbin)
// 404001 = 目标资源不存在
// 500001 = 数据库异常

// 成功响应 (带泛型推导)
return response.Success(c, userDTO)

// 分页成功响应
return response.Page(c, userList, total, page, pageSize)

// 失败响应：必须传入业务状态码常量与国际化提示
return response.Error(c, fiber.StatusNotFound, response.CodeUserNotFound, "用户不存在")
```

### 2.5 GORM 双驱动与 UUID / JSONB 支持规范 (`gorm.io/datatypes`)
- **表主键全量使用 UUID**：
  - 杜绝自增整型，统一使用 `github.com/google/uuid` 的 `uuid.UUID`（推荐时间有序的 UUIDv7 或标准 UUIDv4）。
  - 在 PostgreSQL 下对应原生 `uuid` 类型；在 SQLite 下对应标准字符串文本类型。
  ```go
  type BaseEntity struct {
      ID        uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
      CreatedAt time.Time      `json:"created_at"`
      UpdatedAt time.Time      `json:"updated_at"`
      DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
  }

  func (b *BaseEntity) BeforeCreate(tx *gorm.DB) error {
      if b.ID == uuid.Nil {
          b.ID = uuid.New()
      }
      return nil
  }
  ```
- **复杂结构与配置统一使用 `datatypes.JSONType[T]`**：
  - 底层兼容 PostgreSQL 原生 `jsonb`（支持 GIN 索引与高效检索）和 SQLite 文本存储，同时保证 Go 侧编译期强类型安全。
  - 参考：`https://gorm.io/docs/data_types.html` 及 `datatypes/json_type.go`。
  ```go
  type User struct {
      BaseEntity
      Username    string                               `gorm:"size:64;uniqueIndex;not null" json:"username"`
      Settings    datatypes.JSONType[UserSettings]     `gorm:"type:jsonb" json:"settings"`
      ExtraMeta   datatypes.JSON                       `gorm:"type:jsonb" json:"extra_meta"`
  }
  ```
- 外键关系（如 `sys_user_roles`）统一使用 `user_id uuid.UUID` 与 `role_id uuid.UUID` 关联。
- 初始化连接池必须同时支持 SQLite 与 PostgreSQL，并由 Viper 统一注入池化参数。

### 2.6 认证双通道策略 (Session Cookie 与 JWT 分级)
- **Web 端 SaaS 工作台**：采用 **HttpOnly + Secure + SameSite=Lax 的 Session Cookie**。免除前端存储 Token 被 XSS 窃取的风险，支持服务端空闲/绝对有效期及滑动续期；当前只实现单会话退出。
- **外部 API / OpenAPI / CLI 工具**：采用 **JWT Bearer Token** 鉴权（`Authorization: Bearer <jwt>`），支持跨系统调用，令牌族撤销状态需查询认证存储。
- **Fiber 统一中间件适配**：认证中间件优先解析 Header 凭证，回退匹配 Cookie 会话，统一输出 `c.Locals("current_user")`。

---

### 2.7 日志记录与请求关联规范

运行配置与完整示例见 [后端日志使用说明](docs/BACKEND_LOGGING.md)，正式回归与证据见 [日志专项验收](docs/BACKEND_LOGGING_VALIDATION.md)。新增或修改日志时必须遵守以下约定。

**Context 与依赖注入**：

- 服务启动统一由 `core/logger.New(cfg)` 创建受管理的 logger，通过构造函数注入 Service；业务模块不得自行创建 stdout/file Handler，避免绕过关联、分类和脱敏。
- HTTP 入口使用项目的 `middleware.RequestID()` 包装官方中间件，再挂载 `RequestLogger`；超长外部 ID 在官方存储前处理。保持请求日志在 recover、CORS、认证/鉴权外侧，覆盖下游 panic 和提前返回。
- Handler 传 `c.Context()`，Service/Repository 各操作、事务和重试继续传原 ctx；元数据仅通过 `core/requestmeta` 读写，不新增另一套 request_id Context 键。Service、Repository 和核心日志设施不得为读取请求 ID 依赖 Fiber HTTP 中间件。
- 请求相关日志必须使用 `InfoContext/DebugContext/WarnContext/ErrorContext` 或 `Log(ctx, ...)`。标准 slog 不会自行提取 Context；项目统一 Handler 已实现该能力，无需每次手工追加 request_id。
- 不得把带某次请求信息的 logger 赋回共享 Service 字段；不要在请求链路中用 `context.Background()` 替换 ctx。`request_id/task_id/operator_id` 是保留字段，不能伪造或覆盖其来源，也不能用于授权。
- 后台任务从应用/任务生命周期派生 Context，添加 task_id；用户触发任务从持久化记录恢复可用的 request_id/operator_id。无 HTTP 来源的定时任务不伪造 request_id；异步处理和 SSE 不得持有 fiber.Ctx，复制字符串及关联信息后使用独立生命周期。

**事件与错误处理**：

- 新增业务日志提供稳定的英文 `event`、明确的 `component`，按需追加 `operation`、目标资源 ID；msg 使用固定可读文本，不拼接敏感动态值。耗时统一使用数值毫秒 `duration_ms`。
- 错误向上返回并导致请求失败时，补充操作语义、保留错误链，通常由请求边界记录结果；禁止 Repository、Service、Handler 逐层重复打印同一个错误。SQL 执行事件与 HTTP 汇总属于不同事件，可用同一请求 ID 关联。
- 非致命错误被消化、主流程继续时，必须在处理处记录 Warn；后台任务最终失败记录 Error。重试中间失败按需 Debug，不逐次记录 Error；预期的参数错误、资源不存在、业务冲突不额外打印系统 Error。
- 不输出原始 `err.Error()`、驱动 detail/hint、请求体、配置、密码、Cookie、Token、Authorization 或 DSN。错误诊断使用 `logger.SafeError(err)` 或经审核的稳定安全字段；不能依赖输出层兜底替代调用方脱敏。

非致命辅助操作示例（若原业务要求返回错误，必须保留原返回行为）：

```go
if err := s.users.UpdateColumns(ctx, user.ID, updates); err != nil {
    s.logger.WarnContext(ctx, "Update last login timestamp failed",
        "event", "auth.last_login_update_failed",
        "operation", "update_last_login",
        "user_id", user.ID,
        "error_type", fmt.Sprintf("%T", err),
    ) // component 在构造 Service 时绑定；request_id 由统一 Handler 自动添加。
}
```

**SQL、输出与验证**：

- GORM 必须使用 `core/logger.NewGORM`，最外层适配器保持 `gormlogger.Interface` 和 `gorm.ParamsFilter` 实现；不得另接默认 logger、记录绑定参数或通过 `.Debug()` 绕过 SQL 禁用。Raw/Exec/表达式继续使用绑定参数，SQL 正文省略策略不是通用 SQL 脱敏器。
- 分类固定为 app/access/sql；应用和访问共用 app.log，SQL 使用 sql.log。默认 stdout，file/both 由 logging 配置启用；业务代码不得自开日志文件、共享多进程活动文件或叠加另一套轮转。
- 应用与 SQL 级别独立，不可用应用级别提前过滤 SQL。生产默认 JSON，单行事件保持合法、关联字段位于顶层且不重复；保留 16KiB 事件上限和超限关联摘要。
- 后台轮询如需降噪，只在该轮询查询的派生 Context 上使用 `requestmeta.WithSQLPoll(ctx)`；统一适配器仅过滤无请求来源、成功、非慢查询且返回零行的 INFO SQL。不得以 rows=0、task_id 或 sql_omitted 为通用过滤条件，也不得关闭整个 worker 的错误/慢查询日志；实际处理记录与普通请求 SQL 保留。
- 停机先停止请求/后台任务、关闭业务资源，记录最终结果，再关闭 logger；不要引入绕过清理的 os.Exit。输出故障的安全 stderr 诊断仅由统一日志设施负责，不能递归记录。
- 修改 Context、日志 Handler、SQL 适配器或请求中间件时，运行对应正式回归；至少验证真实 HTTP→Service→Repository 的请求 ID 一致、并发不串号、非致命错误仍保持原响应、敏感哨兵不泄露。涉及 SQL 的变更验证 SQLite/PostgreSQL；缺环境登记未覆盖，不以 Skip 代替通过。行为性改造完成后按项目要求运行 race/vet，纯文档变更检查链接和 diff。

---

## 3. 前端编码规范 (React 19 / shadcn / Base UI / Tailwind v4)

### 3.1 Base UI 代码网格与组件使用规范
1. **采用 `@base-ui/react` 原语体系**：
   - 全面拥抱 Base UI 的解构插槽与 Parts 规范，例如 `<Dialog.Root>`, `<Dialog.Backdrop>`, `<Dialog.Popup>`, `<Popover.Root>`, `<Menu.Root>` 等。
   - 所有浮层组件由 Base UI 负责 ARIA 无障碍焦点捕捉与按键导航，样式完全由 Tailwind CSS v4 驱动。
2. **12 列流式自适应网格规范 (Fluid Code Grid)**：
   - 页面内的卡片、图表与看板容器严格遵循 12 列网格：
     ```tsx
     <div className="grid grid-cols-12 gap-4 md:gap-6">
       <div className="col-span-12 lg:col-span-8">{/* 主数据/表格区 */}</div>
       <div className="col-span-12 lg:col-span-4">{/* 辅助操作/状态区 */}</div>
     </div>
     ```
   - 严禁书写固定宽度（如 `w-[900px]`），所有断点遵循 Tailwind 规范 (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`)。

### 3.2 布局与样式要求
1. **固定视口外壳 + 全宽流式画布**：
   - `SidebarProvider` 与 `SidebarInset` 使用 `h-svh overflow-hidden`，Header 固定 `h-14 shrink-0`，只有 `<main>` 以 `overflow-y-auto` 纵向滚动。
   - 严禁在页面外层随意添加 `container` 或 `max-w-7xl mx-auto` 等强行把内容限定在小盒子的类名。
2. **移动端优先与抽屉导航**：
   - 导航栏使用折叠与响应式抽屉，在小屏下由顶部汉堡菜单唤出；在宽屏下保留固定侧栏。
3. **Tailwind CSS v4**：
   - 采用 CSS 变量与现代 `@theme` 语法。
   - 所有颜色、圆角使用语义变量，如 `bg-background`, `text-foreground`, `border-border`，保证明暗模式无缝切换。
2. **移动端优先与抽屉导航**：
   - 导航栏使用折叠与响应式抽屉，在小屏下由顶部汉堡菜单唤出；在宽屏下保留固定侧栏。
3. **Tailwind CSS v4**：
   - 采用 CSS 变量与现代 `@theme` 语法。
   - 所有颜色、圆角使用语义变量，如 `bg-background`, `text-foreground`, `border-border`，保证明暗模式无缝切换。

### 3.2 数据表格组件接入与使用规范
- 复用 `src/components/data-table` 的完整组件包：
  - `DataTable`: 核心表格容器。
  - `DataTableColumnHeader`: 带升降序排序的列标题。
  - `DataTablePagination`: 服务端/客户端分页控件。
  - `DataTableToolbar`: 搜索过滤与批量操作栏。
  - `DataTableFacetedFilter`: 离散标签/多选过滤器（如角色、状态筛选）。
  - `DataTableDateRangeFilter`: 日期区间选择器。
  - `DataTableViewOptions`: 动态列显隐控制菜单。
- 所有表格列配置必须使用强类型 `ColumnDef<TData, TValue>`。
- `src/components/ui/` 为 shadcn 生成的原子组件，业务需求不得修改；禁止 `window.confirm` / `window.alert`，危险操作使用 `useConfirm()`（AlertDialog），结果反馈使用 `notify`（Toast）。
- 按钮级权限使用 `can("<code>")` / `<Can>`，页面级使用 `RequirePermission`；权限编码来自 `/auth/me` 返回的有效权限（含祖先节点，超级管理员为 `*`）。

### 3.3 Web Cookie 会话请求规范
- Axios 设置 `withCredentials: true`，不从 localStorage 注入 Token，也不进行浏览器端 Token 刷新。
- 启动时调用 `/api/v1/auth/me` 恢复身份；401 清理内存状态，网络/500 错误保留可重试状态。登录失败显示表单错误，退出失败不得宣称已注销。
- Cookie 写请求需要可信 Origin 或 Referer；信任来源由 `security.trusted_origins` 配置。外部客户端使用 `/api/v1/auth/token` 和 `/api/v1/auth/refresh`。

---

## 4. 协作工作流与指令规范 (Agent Execution Rules)

1. **环境与运行前置检查**：
   - 后端启动前确认依赖完整（`go mod tidy`），SQLite 数据目录自动创建（`mkdir -p ./data`）。
   - 前端依赖安装推荐使用 `npm install`。
2. **渐进式验证**：
   - 每次完成核心模块后，AI Agent 必须编写或运行轻量验证脚本或单元测试，确保接口返回与响应结构 100% 吻合。
3. **保护用户资产**：
   - 绝对不可修改无关目录，非用户请求范围的文件切勿擅自改动。
