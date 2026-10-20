# InfraNexus 敏捷企业级全栈脚手架需求规格说明书 (Requirements Document)

## 1. 项目定位与设计目标

**InfraNexus** 是一套面向现代云原生与企业级 SaaS 平台的敏捷开发脚手架。
后端基于 **Go 1.27+ / GoFiber v3**，前端基于 **React 19 / Vite / Tailwind CSS v4 / shadcn/ui · Base UI**。

### 核心设计原则
1. **轻量极速，极致性能**：依托 Fiber v3 底层 fasthttp 高性能内核与前后端现代化工程链。
2. **三层解耦，接口注入**：`Handler -> Service -> Repository` 严格分层，接口抽象，`main.go` 保持薄装配（Thin Main）。
3. **全局唯一 UUID 主键**：全量数据表主键摒弃自增整型，统一采用 **UUID（优先使用基于时间排序的 UUIDv7 或标准 UUID）**，充分利用 项目使用 `github.com/google/uuid`，保证分布式环境下 ID 的全局唯一性、防止 ID 遍历攻击且兼顾索引性能。
4. **双擎数据库无缝切换**：同一套 GORM 模型与迁移脚本，通过配置无缝切换 **PostgreSQL**（原生 UUID 与 JSONB）与 **SQLite**（文本兼容存储），适应高并发生产与单机交付。
5. **全集成 Fiber 生态**：深度整合 GoFiber 官方中间件（Casbin, JWT, RequestID, ResponseTime, SSE, CORS, Recover, Logger）及可插拔 Storage 驱动（S3, Postgres, Redis, SQLite3, Memory）。
6. **企业级 RBAC 权限控制**：基于 Casbin 模型的动态细粒度权限校验，支持菜单/操作/API多层管控。
7. **SaaS 流式全宽工作台**：前端布局主工作区采用 **全宽度流式响应（Full-width Fluid Canvas）**，杜绝大屏居中受限收窄；移动端自适应抽屉式导航；支持第一方 Session Cookie 无感续签。

---

## 2. 后端架构与功能需求规格 (Backend Requirements)

### 2.1 技术栈基底
| 组件/模块 | 选型与版本 | 用途与说明 |
| :--- | :--- | :--- |
| **基础语言** | **Go 1.27+** | 全面支持深层泛型约束、泛型仓储基类、更高性能并发运行时 |
| **HTTP 引擎** | `github.com/gofiber/fiber/v3` (v3.0.0-beta+) | 高性能 Web 框架，集成原生 Context |
| **ORM 框架** | `gorm.io/gorm` + `gorm.io/datatypes` | 兼容 SQLite 与 PostgreSQL，使用 `datatypes.JSONType[T]` 实现强类型泛型 JSONB 映射 |
| **配置中心** | `github.com/spf13/viper` | 支持 yaml/env 配置读取，连接池精细化管理 |
| **结构化日志** | `log/slog` | 结合 Fiber RequestID 中间件实现 Trace 关联日志 |
| **缓存/存储** | `github.com/redis/go-redis/v9` + Fiber Storage | 统一缓存与 Session/限流/持久化接口 |
| **权限中枢** | `github.com/casbin/casbin/v3` + `casbin/gorm-adapter/v3` | RBAC 策略动态计算；鉴权中间件为 contrib 同形自研实现（`gofiber/contrib/casbin` 依赖 casbin/v2） |
| **目录集成** | `github.com/go-ldap/ldap/v3` | AD / LDAP 连接测试、域账号认证与组织架构同步 |
| **身份认证体系** | **双通道认证 (Dual-Channel Auth)** | **前端优先 HttpOnly Session Cookie**；**第三方与 CLI 优先 JWT Bearer Token** |
| **输入校验** | GoFiber Validation (`go-playground/validator/v10`) | DTO 请求体验证、自定义错误语义翻译 |

### 2.2 配置管理需求 (Viper Configuration)
配置文件统一命名为 `config.yaml`，支持环境变量覆盖（Prefix: `APP_`）。核心配置项必须包含：
```yaml
app:
  name: "infranexus-api"
  env: "development" # development | test | production
  port: 8080
  debug: true

database:
  driver: "postgres" # "postgres" | "sqlite"
  sqlite:
    dbpath: "./data/infranexus.db"
  postgres:
    host: "127.0.0.1"
    port: 5432
    user: "postgres"
    password: "your_password"
    dbname: "infranexus_db"
    sslmode: "disable"
  pool:
    max_idle_conns: 10
    max_open_conns: 100
    conn_max_lifetime: 3600 # 秒

redis:
  host: "127.0.0.1"
  port: 6379
  password: ""
  db: 0
  pool_size: 50

jwt:
  secret: "your-jwt-secure-secret-key"
  access_token_expire: 900    # 15分钟 (无感刷新)
  refresh_token_expire: 604800 # 7天
  issuer: "infranexus-auth"

storage:
  driver: "memory" # "memory" | "sqlite3" | "postgres" | "redis" | "s3"
  s3:
    bucket: "infranexus-assets"
    endpoint: "s3.amazonaws.com"
    region: "us-east-1"
    access_key: ""
    secret_key: ""

security:
  encryption_key: "change-me" # AES-GCM 加密目录绑定密码；production 拒绝空值与默认开发密钥

ldap:
  scheduler:
    enabled: true
    tick_seconds: 60 # 检查到期同步任务的间隔
```

### 2.3 统一响应模型与业务状态码挂钩规范 (Business-Linked Response Envelope)
所有 HTTP 接口必须严格输出统一的 JSON 报文结构。报文中的 `code` 不仅是 HTTP 状态码，而是**强类型绑定的领域业务状态码 (Domain Business Code)**：
```json
{
  "code": 200000,
  "message": "操作成功",
  "data": { ... },
  "request_id": "c1f7a0b5-7c38-4e89-a548-28312df5fa8b",
  "timestamp": 1729402800
}
```

#### 领域业务状态码分段规范 (Business Code Taxonomy)
业务状态码采用 6 位十进制数 `HHHCCC`：前三位是 HTTP 状态类别，后三位是该类别下的业务细分。例如 `401001`。

| HTTP 状态 | 业务 Code | 常量名称 | 语义解释与前端指引 |
| :--- | :--- | :--- | :--- |
| `200 OK` | `200000` | `CodeSuccess` | 操作成功，正常渲染数据 |
| `400 Bad Request` | `400001` | `CodeParamInvalid` | 请求参数格式错误，data 附带字段校验列表 |
| `400 Bad Request` | `400002` | `CodePasswordTooWeak` | 密码强度不足（≥8 位且含大写/小写/数字/符号中任意 3 类） |
| `400 Bad Request` | `400003` | `CodeDomainNotFound` | 认证域不存在或未启用 |
| `401 Unauthorized` | `401001` | `CodeTokenExpired` | 凭证无效或已过期，Web 清理内存身份状态 |
| `401 Unauthorized` | `401002` | `CodeInvalidCredentials` | 账号或密码不匹配；域账号失败统一提示「域认证账号或密码错误」 |
| `401 Unauthorized` | `401003` | `CodeSessionRevoked` | 会话已撤销 |
| `403 Forbidden` | `403001` | `CodePermissionDenied` | Casbin 拦截，当前角色无操作权限 |
| `403 Forbidden` | `403002` | `CodeAccountDisabled` | 账号已被停用，禁止操作 |
| `403 Forbidden` | `403003` | `CodeBuiltinProtected` | 内置管理员 / 内置角色 / 内置权限点受保护 |
| `403 Forbidden` | `403004` | `CodeSelfOperationDenied` | 不能对当前登录账号执行停用、删除等操作 |
| `404 Not Found` | `404001` | `CodeUserNotFound` | 目标用户不存在 |
| `404 Not Found` | `404002` | `CodeRoleNotFound` | 目标角色不存在 |
| `404 Not Found` | `404003` | `CodeDepartmentNotFound` | 目标部门不存在 |
| `404 Not Found` | `404004` | `CodePermissionNotFound` | 目标权限点不存在 |
| `404 Not Found` | `404005` | `CodeDirectoryConfigNotFound` | 目录配置不存在 |
| `409 Conflict` | `409001` | `CodeResourceConflict` | 唯一约束冲突（如用户名或邮箱已存在） |
| `409 Conflict` | `409002` | `CodeDepartmentHasChildren` | 部门下仍有子部门，禁止删除 |
| `409 Conflict` | `409003` | `CodeDepartmentHasMembers` | 部门下仍有成员，禁止删除 |
| `409 Conflict` | `409004` | `CodeDepartmentInvalidParent` | 上级部门非法（成环、超过 15 级或已停用） |
| `409 Conflict` | `409005` | `CodeSyncInProgress` | 该目录配置正在同步 |
| `409 Conflict` | `409006` | `CodePermissionHasChildren` | 权限点下仍有子节点 |
| `409 Conflict` | `409007` | `CodeExternalAccountManaged` | 域账号由目录服务管理（如不可重置本地密码） |
| `429 Too Many Requests` | `429001` | `CodeRateLimited` | 登录或 Token 获取过于频繁 |
| `500 Server Error` | `500001` | `CodeDatabaseError` | 数据库执行异常，内部记录详细 SQL 日志 |
| `500 Server Error` | `500002` | `CodeInternalError` | 系统未捕获未知故障 |
| `502 Bad Gateway` | `502001` | `CodeDirectoryUnavailable` | AD / LDAP 目录服务不可达或返回异常 |

### 2.4 GORM 多驱动与 JSONB 强类型支持 (`gorm.io/datatypes`)
结合 `gorm.io/datatypes`，在 PostgreSQL 下映射为高性能原生的 `JSONB` 索引字段，在 SQLite 下映射为 JSON 兼容文本字段。利用 **Go 1.27+ 泛型** 使用 `datatypes.JSONType[T]` 实现编译期强类型绑定与自动序列化：

```go
package domain

import (
	"time"
	"github.com/google/uuid" // 项目当前 UUID 实现
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// 通用实体基类，主键全量使用 UUID
type BaseEntity struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (b *BaseEntity) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New() // 优先使用有序 UUIDv7 或标准 UUID
	}
	return nil
}

// 用户偏好泛型结构体
type UserPreferences struct {
	Theme         string   `json:"theme"`           // "dark" | "light" | "system"
	Locale        string   `json:"locale"`          // "zh-CN" | "en-US"
	PinnedRoutes  []string `json:"pinned_routes"`   // 钉住的快捷菜单
	Notifications struct {
		Email bool `json:"email"`
		WebPush bool `json:"web_push"`
	} `json:"notifications"`
}

// 实体模型中直接声明泛型 JSON 字段与 UUID 主键
type User struct {
	BaseEntity
	Username    string                               `gorm:"size:64;uniqueIndex;not null" json:"username"`
	Preferences datatypes.JSONType[UserPreferences]  `gorm:"type:jsonb" json:"preferences"`
	Metadata    datatypes.JSON                       `gorm:"type:jsonb" json:"metadata"`
	// ...
}
```

### 2.5 身份认证双通道架构设计 (Session Cookie + JWT Dual-Channel)
采用 SaaS 企业级分级安全设计：
1. **第一方 Web SPA / SaaS 工作台（First-Party Browser UI）**：
   - 采用 **HttpOnly + Secure + SameSite=Lax 的 Session Cookie**。
   - HttpOnly 阻止脚本直接读取 Cookie，但应用仍须防范 XSS。
   - **平滑会话延期**：基于滑动窗口（Sliding Window），用户持续操作时由后端自动刷新 Cookie Max-Age，免去前端复杂的并发刷新与请求拦截挂起逻辑。
   - **当前会话退出**：后端删除当前 Session；全端退出留待后续阶段。
2. **开放 API / 第三方系统 / CLI 自动化（OpenAPI / Webhook / Agent）**：
   - 采用 **JWT Bearer Token** 鉴权（通过请求头 `Authorization: Bearer <token>` 传递）。
   - 便于第三方无 Cookie 跨域调用、设定固定有效期的访问令牌以及细粒度 Scope 限制。
3. **Fiber 中间件统一归一化**：
   - 认证中间件优先提取 `Authorization: Bearer <token>`；仅当 Authorization 头不存在时回退 Cookie；无效 Bearer 直接拒绝。
   - 提取成功后统一注入 `c.Locals("current_user", userContext)`，下游业务 Handler 零心智负担。

### 2.6 中间件链路流水线 (Middleware Pipeline)
GoFiber v3 按照以下顺序装配全局中间件：
1. **Recover 中间件** (`gofiber/middleware/recover`): 捕获未处理 panic 并向客户端返回统一的 500 结构体。
2. **RequestID 中间件** (`gofiber/middleware/requestid`): 生成 UUIDv4 / Snowflake 并注入 Header `X-Request-Id` 和 Context。
3. **ResponseTime 中间件** (`gofiber/middleware/responsetime`): 计算耗时并写入 `X-Response-Time`。
4. **CORS 中间件** (`gofiber/middleware/cors`): 跨域资源共享配置，支持携带凭据与动态 Origin。
5. **Logger 结构化中间件** (`gofiber/middleware/logger` + `slog` 桥接): 格式化输出访问日志，带 RequestID、ClientIP、Latency、Status、Method、Path。
6. **ErrorHandler 统合** (`app.Config.ErrorHandler`): 拦截 Fiber/业务异常，自动包装为统一 JSON 错误结构。
7. **业务专属中间件**:
   - `DualAuth`: 校验 JWT 用途、issuer、有效期与令牌族，或校验 Session；每次读取当前用户状态和角色。
   - `middleware.NewCasbin(...).RoutePermission()`: 以用户角色编码为 subject 校验 `(role, 路由模板, Method)`，`admin` 超级角色直通。
   - `sse.New(...)`: 专用于长链接事件推送（如实时系统通知、任务队列进度推送）。

### 2.5 核心模块业务需求
1. **用户认证模块 (Auth)**:
   - 密码加密存储（Argon2id 或 Bcrypt 12轮哈希）。
   - Web 登录只设置 HttpOnly Session Cookie 并返回用户；外部客户端通过 `/api/v1/auth/token` 获取 Access/Refresh Token。
   - 用户登出：撤销当前 Session 或 JWT 令牌族。
   - Token 刷新接口 (`POST /api/v1/auth/refresh`)：原子轮换有效 RefreshToken，返回新 TokenPair；重放旧令牌拒绝。
2. **用户管理模块 (Users)**:
   - 用户分页查询、按用户名/邮箱/状态/角色/来源/部门（可含下级）筛选。
   - 重置密码（强度校验，撤销该用户全部会话与令牌）；`POST /api/v1/users/batch-move-department` 事务化批量调岗。
   - 创建/更新/删除（软删除 `gorm.DeletedAt`）用户。
   - 用户分配单角色或多角色。
   - 用户状态启停（禁用后下一次认证立即拒绝）。
3. **角色管理模块 (Roles)**:
   - 角色 CRUD，角色代码必须具有唯一性（如 `admin`, `operator`, `auditor`）。
   - 角色关联权限菜单树与 API 资源规则。
   - 自动同步 Casbin 规则表（`casbin_rule`）。
4. **权限与菜单管理模块 (Permissions & Menus)**:
   - 权限树状结构维护：目录、菜单、按钮/操作。
   - API 资源绑定（路径、HTTP Method）。
   - 前端权限指令与动态路由注册元数据输出。
   - `POST /api/v1/permissions/sync` 扫描已注册受控路由，补登记接口权限点并重建全部角色策略。
5. **部门管理模块 (Departments)**:
   - 部门树（`TreePath` 物化路径，最多 15 级）CRUD、移动与同级排序；存在子部门或成员时禁止删除。
6. **目录集成与多源认证模块 (AD / LDAP)**:
   - 目录配置（绑定密码加密存储）、连接测试、同步预览，手动全量/增量同步与按间隔定时全量同步，OU 或属性映射部门，同步报告与日志。
   - 登录携带 `domain` 时走目录认证：服务账号检索用户 DN 后以用户凭据绑定；首次登录按默认角色自动建档（JIT），与本地账号共用 Session/JWT 体系。

---

## 3. 前端架构与功能需求规格 (Frontend Requirements)

### 3.1 技术栈基底
| 组件/模块 | 选型与版本 | 用途与说明 |
| :--- | :--- | :--- |
| **构建工具** | Vite 8 + npm | 极速冷启动与 HMR |
| **视图框架** | React 19 + TypeScript | 最新并发特性与强类型安全 |
| **UI 基础原语** | **`@base-ui/react` (Base UI)** | 现代化无样式无头原语库（解耦 Radix，采用组件插槽与 Parts 解构模式） |
| **组件封装** | **`shadcn` + `@shadcn/react`** | 基于 Base UI 原语包装的原子与业务组件 |
| **样式与网格体系**| **Tailwind CSS v4** | CSS 变量主题、现代 `@theme` 规范、12列流式网格系统 |
| **表格中枢** | TanStack React Table v9 | 深度复用 `components/data-table` 企业级组件 |
| **状态/请求** | Axios + TanStack React Query v5 | 缓存网络请求、乐观更新、请求去重 |
| **表单与校验** | `react-hook-form` / `@tanstack/react-form` + `zod` | 强类型表单校验 |

### 3.2 Base UI 代码网格与 SaaS 工作台布局规范 (Base UI & Fluid Canvas)
1. **Base UI 原语使用规范**：
   - 区别于传统 Radix UI，Base UI 采用语义化的 Parts 架构（如 `<Dialog.Root>`, `<Dialog.Backdrop>`, `<Dialog.Popup>`, `<Popover.Root>`, `<Select.Root>`, `<Menu.Root>`）。
   - 所有的弹出层（Popup/Backdrop）必须配合 Tailwind CSS v4 的过渡动画与 CSS 变量进行渲染，确保无样式闪烁。
2. **12 列流式代码网格系统 (12-Column Fluid Grid System)**：
   - 工作台卡片与图表容器统一采用 `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6` 或 12 列网格 `grid grid-cols-12 gap-4` 进行划分。
   - 严禁固定像素宽度（如 `w-[800px]`），必须使用响应式列宽（如 `col-span-12 lg:col-span-8`，`col-span-12 lg:col-span-4`）。
3. **全宽度流式画布 (Full-width Fluid Canvas)**:
   - 外壳固定视口：`SidebarProvider` / `SidebarInset` 为 `h-svh overflow-hidden`，Header `h-14 shrink-0`，仅主内容 `<main>` 以 `overflow-y-auto` 滚动。
   - 严禁添加限制页面上限宽度的类名（如 `container` 或 `max-w-7xl mx-auto`），确保在 2K / 4K / 34寸带鱼屏等超宽设备下，数据表格各列能够横向充分自适应展示。
4. **移动端自适应与抽屉导航 (Responsive Drawer)**:
   - **桌面端 (≥1024px)**: 侧边栏常驻，可一键切换完整展开与 Mini 图标模式。
   - **移动端 (<1024px)**: 侧边栏自动收起，通过 Header 汉堡按钮唤出 Base UI `<Drawer.Root>` 抽屉，支持手势滑动收起。

### 3.3 Web 会话恢复与错误处理
浏览器使用 `withCredentials` 携带 Session Cookie；前端启动时调用 `GET /api/v1/auth/me` 校验身份，用户资料只保存在内存。401 清理身份并引导重新登录；网络或 500 错误显示重试，不视为凭据过期。浏览器不存储或刷新 JWT。登录及 Cookie 写请求须来自 `security.trusted_origins` 精确列出的来源，或带同源 Referer；生产 Cookie 强制 Secure。API Token 通道不使用环境 Cookie 授权。进程内登录限流不跨实例共享。

### 3.4 企业级数据表格引入规格 (Data-Table Integration)
完整导入并适配 `@[/Users/liangyx/Documents/GoProject/storage-net/frontend/src/components/data-table]` 模块，提供如下核心能力：
1. **服务端分页与排序**（通过 `data-table-pagination.tsx`）。
2. **列显示/隐藏动态配置**（通过 `data-table-view-options.tsx`）。
3. **多维多选 Faceted 筛选**（用户状态、角色标签、日期范围筛选）。
4. **骨架屏加载与优雅空状态**（`data-table-skeleton.tsx` 与 `data-table-empty.tsx`）。
5. **高度可扩展的工具栏**（集成批量操作、新建按钮、全局过滤）。

---

## 4. 非功能性需求与性能指标
- **API 延迟**：本地 SQLite/Postgres 下 P99 < 15ms（基于 GoFiber v3 + fasthttp 极致性能）。
- **打包体积**：前端生产 Bundle 通过代码分割（Code Splitting）实现首次加载资源 < 350KB (gzip)。
- **安全加固**：
  - 默认启用 CSP、X-Frame-Options、HSTS 安全头。
  - SQL 注入防御：全量使用 GORM 参数化绑定，杜绝原生拼接。
  - XSS 防御：前端 React JSX 原生转义 + 数据消毒。
  - CSRF 防御：Cookie 写请求校验可信 Origin/Referer，并使用 SameSite=Lax。
