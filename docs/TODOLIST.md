# InfraNexus 工程交付与实施待办清单 (TODOLIST.md)

本清单用于追踪 **InfraNexus** 脚手架从 0 到 1 的开发交付进度。每个阶段均附有明确的可验证交付物。

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

实施契约见 [具体实施方案](docs/PRIORITY_REMEDIATION_PLAN.md)。以下状态以本轮测试证据为准，上方历史完成记录不代表重新验收通过。

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
