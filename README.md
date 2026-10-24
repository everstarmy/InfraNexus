# InfraNexus

基于 **Go / Fiber v3 / React 19** 的前后端分离管理工作台脚手架，提供身份认证、权限控制、组织人员管理、AD/LDAP 目录同步、实时通知和日志基础设施，可在此基础上扩展业务模块。

项目已实现登录及六个工作台模块：**仪表盘、用户管理、部门管理、角色管理、权限清单、目录同步**。后端采用 Handler → Service → Repository 分层与接口注入；前端提供通用工作台布局、数据表格、表单和权限组件。

本文按当前代码与截至 **2026-10-23** 的验收记录汇总已完成内容。验证范围和环境限制见文末，后续进度以 [任务清单](docs/TODOLIST.md) 为准。

## 已完成的业务模块

| 模块 | 当前能力 |
| --- | --- |
| 登录与身份 | 本地账号及企业域账号登录；Web Cookie 会话恢复、滑动续期和单会话退出；外部客户端 JWT 签发、刷新与令牌族撤销 |
| 仪表盘 | 从后端获取平台概览、用户与组织统计，按权限展示工作台入口 |
| 用户管理 | 分页、搜索与筛选；创建、编辑、详情、启停、重置密码、多角色分配；部门归属和批量调岗；编辑版本冲突检测与草稿保留 |
| 部门管理 | 部门树、创建和编辑、移动与排序、成员管理；层级、循环引用和删除保护；可见节点虚拟化、搜索定位及拖拽交互 |
| 角色管理 | 角色创建、编辑、启停和删除；权限树授权、角色成员查看与内置角色保护 |
| 权限清单 | 菜单、按钮、API 权限点树；权限维护；扫描后端路由、同步权限并展示差异报告 |
| AD / LDAP 目录同步 | 多目录配置与连接测试；属性映射和 OU/属性部门映射；域账号首次登录建档；全量/增量同步预览、差异确认、手动/定时执行、任务详情与结果报告 |
| 实时通知 | 目录同步进度与终态通知；SSE 心跳、游标恢复、去重、重连退避与断档后重新获取数据；连接期间复核身份和权限 |

## 前端基础能力

- **工作台布局**：固定视口外壳、独立主区滚动、可折叠侧栏、移动端抽屉导航、全宽内容区；支持明暗主题、系统主题和用户偏好。
- **通用数据表格**：TanStack Table v9 封装，提供类型化列、排序、分页、搜索、多选筛选、日期区间、列显隐、选择操作、骨架屏及空状态。
- **交互组件**：基于 shadcn / Base UI 的对话框、侧滑面板、表单和菜单；统一危险操作确认、Toast 反馈、加载与错误重试状态。
- **认证与授权**：Axios Cookie 请求，启动时恢复身份；401 清理身份、网络异常保留重试入口；按有效权限控制导航、页面和按钮，使用 `RequirePermission`、`can()` 和 `<Can>`。
- **表单与并发编辑**：未保存内容离开提醒；用户编辑发生版本冲突时保留草稿、显示差异并由用户确认重试；异步提交期间防重复操作。
- **导航与性能**：命令面板、页面懒加载和预加载；部门树虚拟化；键盘、触控、焦点恢复与 reduced-motion 适配。

## 后端基础能力

- **分层与统一契约**：domain 定义实体和接口，构造函数装配依赖；泛型 Repository、UUID 主键、强类型 JSON 配置；统一 JSON 响应、业务码、领域错误与 Request ID。
- **双数据库与迁移**：GORM 支持 SQLite/PostgreSQL、连接池、版本化迁移与初始化数据；组织调整和授权变更使用事务、版本检查及并发控制。
- **双通道认证**：Web 使用 HttpOnly Session Cookie，支持空闲/绝对有效期；外部客户端使用 Bearer JWT。Header 凭据优先，失效时不回退 Cookie；用户停用、改密及认证版本变更参与凭据校验。
- **RBAC 与多实例一致性**：Casbin v3 控制角色/API 访问，前后端共用有效权限；授权 revision、事务 Outbox、Redis 通知和后台收敛实现跨实例更新。Casbin 中间件为项目适配实现。
- **目录任务可靠性**：绑定密码加密存储；目录请求支持取消和总时限；预览计划、幂等提交、任务租约、进度持久化与过期任务恢复；不完整搜索不会直接作为完整目录执行缺失账号停用。
- **运行日志**：统一 slog，应用/访问/SQL 分类；Service 自动关联请求，后台任务关联任务来源；独立级别、慢查询、SQL 绑定参数保护、标准输出和文件轮转。
- **存储与生命周期**：统一 Fiber Storage 工厂已接入 memory、SQLite、PostgreSQL、Redis、S3 驱动；提供后台任务管理、资源关闭及 SIGINT/SIGTERM 平滑停机。存储驱动属于基础设施，可供后续业务接入。

## 技术栈

| 层次 | 使用技术 |
| --- | --- |
| 后端 | Go 1.27.2+、Fiber v3、GORM、Casbin v3、Viper、slog |
| 数据与存储 | SQLite / PostgreSQL、Redis、gorm datatypes、Fiber Storage |
| 前端 | React 19、TypeScript、Vite 8、React Router 7、Axios、React Query |
| UI 与数据展示 | Tailwind CSS v4、shadcn / Base UI、TanStack Table v9、Lucide、Recharts |
| 测试 | Go test / race / vet、Vitest、Playwright、Axe |
| 部署 | 多阶段 Docker 镜像、Docker Compose、Nginx、非 root 运行及健康检查 |

具体依赖版本以 [go.mod](backend/go.mod)、[package.json](frontend/package.json) 和锁文件为准。

## 项目结构

```text
InfraNexus/
├── backend/
│   ├── cmd/server/             # 服务入口与管理员初始化/口令轮换命令
│   ├── internal/
│   │   ├── bootstrap/          # 数据库、Redis、Casbin、路由及依赖装配
│   │   ├── config/             # 配置加载与校验
│   │   ├── core/               # 日志、响应、错误、请求元数据、加密等
│   │   ├── domain/             # 领域实体与接口
│   │   ├── handler/            # HTTP 接入与 SSE
│   │   ├── service/            # 业务逻辑及后台任务
│   │   ├── repository/         # 数据库、认证存储及目录访问
│   │   └── storage/            # Fiber Storage 驱动工厂
│   ├── config.yaml
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── components/         # 通用组件、ui、data-table、权限与确认组件
│   │   ├── layouts/            # 工作台外壳、导航及用户偏好
│   │   ├── pages/              # 登录及六个工作台模块
│   │   ├── services/           # Axios 实例与 API 调用
│   │   ├── stores/             # 认证与通知 Context
│   │   ├── hooks/              # 通用交互逻辑
│   │   └── routing/            # 页面加载及路由相关封装
│   ├── e2e/                    # 浏览器与性能回归
│   ├── nginx.conf
│   └── package.json
├── docs/                       # 需求、架构、API、操作手册与验收证据
├── compose.yaml
├── .env.example
├── Makefile
└── AGENTS.md                   # 开发约定与日志记录规范
```

## 本地开发

以下命令均从仓库根目录执行。

### 环境与依赖

需要 Go 1.27.2+、支持 CGO 的 C 编译工具链（SQLite 驱动使用 CGO）、Node.js 22.12+ 和 npm。前端 Docker 构建使用 Node 24.11.1。

```sh
go -C backend mod tidy
npm --prefix frontend install
```

默认配置使用 SQLite，数据库目录会自动创建。开发环境 Redis 不可用时，认证存储可回退进程内模式；要使用 Redis SSE 事件和跨实例能力，需要连接 Redis。生产环境 Redis 不可用会拒绝启动。

### 初始化管理员

服务不会创建带公开默认密码的账号。通过运行环境注入一次性的 `INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD` 强口令后执行：

```sh
go -C backend run ./cmd/server bootstrap-admin
```

用户名为 `admin`。该命令只创建缺失账号，重复执行不覆盖密码。需要轮换已存在的内置管理员密码时，重新注入上述一次性变量并执行：

```sh
go -C backend run ./cmd/server rotate-admin-password
```

轮换会递增认证版本，使旧 Session 和令牌失效；完成后移除一次性口令变量。平时也可使用已授权的用户密码重置操作。

### 启动前后端

在两个终端分别执行：

```sh
make dev-backend
```

```sh
make dev-frontend
```

访问 [前端工作台](http://127.0.0.1:5173)，后端监听端口 8080；Vite 将 `/api` 代理到后端。健康接口为 [GET /api/v1/health](http://127.0.0.1:8080/api/v1/health)。其他开发、构建命令可用 `make help` 查看。

## 配置与认证

后端配置位于 [backend/config.yaml](backend/config.yaml)，由 Viper 加载。环境变量使用 `APP_` 前缀，将配置路径的点替换为下划线，例如：

| 配置 | 环境变量 | 用途 |
| --- | --- | --- |
| `app.env` | `APP_APP_ENV` | development / test / production |
| `database.driver` | `APP_DATABASE_DRIVER` | sqlite / postgres |
| `redis.host` | `APP_REDIS_HOST` | Redis 主机 |
| `jwt.secret` | `APP_JWT_SECRET` | JWT 签名密钥 |
| `security.encryption_key` | `APP_SECURITY_ENCRYPTION_KEY` | 目录绑定密码加密密钥 |
| `security.trusted_origins` | `APP_SECURITY_TRUSTED_ORIGINS` | 可信 Web 来源，影响 CORS 与 Cookie 写请求校验 |

Web 使用 Cookie，生产环境强制 Secure 并应经 HTTPS 同源部署；前端不存储 JWT。会话空闲/绝对有效期分别由 session.max_age/session.absolute_max_age 控制。外部客户端使用 `/api/v1/auth/token` 和 `/api/v1/auth/refresh`，携带 `Authorization: Bearer ...` 调用 API。当前 Web 退出撤销单个会话。

生产环境需设置独立 JWT/加密密钥和真实可信来源；更换目录加密密钥需要按现有目录凭据处理流程执行。接口、权限和版本冲突契约见 [API 文档](docs/API.md)。

## Docker 部署

```sh
cp .env.example .env
```

在 `.env` 中设置相互独立的 `DB_PASSWORD`、`JWT_SECRET` 和 `ENCRYPTION_KEY` 后启动：

```sh
docker compose up -d --build --wait
```

Compose 启动前端 Nginx、后端、PostgreSQL 和 Redis；默认入口为 [http://localhost:8080](http://localhost:8080)，只绑定宿主机 loopback。PostgreSQL/Redis 使用持久卷且不向宿主机发布端口，前端通过 Nginx 代理 API/SSE。

通过当前 shell 注入一次性管理员口令后执行：

```sh
docker compose run --rm -e INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD app bootstrap-admin
unset INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD
```

`.env.example` 面向本机 HTTP 开发；正式 HTTPS 部署设置 APP_ENV=production、SESSION_SECURE=true 和实际 TRUSTED_ORIGINS，并配置外层 TLS 终止。Compose 的 APP_ENV/JWT_SECRET 等变量由 compose.yaml 映射到后端环境变量。

```sh
docker compose ps
docker compose logs -f app frontend
docker compose down
```

日常停止保留数据卷。构建参数、初始化、持久化和网关配置见 [Docker 部署说明](docs/DOCKER.md)。

## 日志与排查

默认日志进入 stdout。开发 debug 模式缺省使用 text，非 debug 模式缺省使用 JSON，生产环境缺省格式为 JSON。应用、访问、SQL 分别标记 category=app/access/sql；Service 使用 Context 日志方法自动携带 request_id，异步任务携带 task_id 和可用的来源信息。

授权 Outbox 后台轮询的正常空结果 SQL 自动过滤，无需修改日志参数；查到待处理记录、慢查询和错误仍按配置记录，普通请求的空结果查询也保留。

应用与 SQL 级别独立。例如，同时输出终端和文件，SQL 只记录错误与慢查询：

```sh
APP_LOGGING_OUTPUT=both APP_LOGGING_SQL_LEVEL=warn go -C backend run ./cmd/server
```

该命令工作目录为 backend，默认文件位于 `backend/logs/app.log` 和 `backend/logs/sql.log`。logging.file.directory 可调整目录；默认单文件 100MB 轮转、最多 10 个备份、最长保留年龄 14 天并压缩。数量和年龄共同约束，不保证完整保存 14 天。

Compose 使用 `.env` 的 LOG_LEVEL/SQL_LOG_LEVEL 控制级别，四服务均配置 local 驱动、每容器 20m×5 轮转：

```sh
docker compose logs --since 30m app
```

SQL 绑定参数与驱动原始错误详情不输出，业务仍须使用参数化查询并遵守日志脱敏约定。完整字段、Context 传递、Service 错误写法及故障边界见 [日志使用说明](docs/BACKEND_LOGGING.md) 和 [AGENTS.md §2.7](AGENTS.md#27-日志记录与请求关联规范)。

## 测试与当前验证范围

后端默认使用临时 SQLite；完整测试、竞争检测与静态检查：

```sh
go -C backend test -count=1 -p=1 ./...
go -C backend test -race -count=1 -p=1 ./...
go -C backend vet ./...
```

PostgreSQL/Redis 集成矩阵需指向**独立、空白、可丢弃**的测试实例，测试会修改数据库和事件状态：

```sh
INFRANEXUS_TEST_POSTGRES_DSN='postgres://<user>:<password>@127.0.0.1:5432/<isolated_test_db>?sslmode=disable' \
INFRANEXUS_TEST_REDIS_ADDR='127.0.0.1:<isolated_redis_port>' \
go -C backend test -race -count=1 -p=1 ./...
```

前端单测、构建、浏览器与性能回归：

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
npm --prefix frontend run test:perf
```

已登记的验证包括：

| 范围 | 记录 |
| --- | --- |
| 后端 | 全量 race/vet，SQLite/PostgreSQL 并发、事务及故障回滚，真实 Redis 跨实例通知与连接回收 |
| 前端 | Vitest、生产构建、Playwright；权限、表单冲突与草稿、通知恢复、多视口、明暗主题、键盘/触控、Axe 自动检查 |
| 性能 | 部门树 1k/10k 节点虚拟化、过滤与 DOM/长任务预算；属于固定本机环境下的测量 |
| 集成与部署 | 授权测试 AD 的只读认证/搜索及隔离应用同步，Docker/Nginx SSE 故障与停机，镜像构建和持久化冒烟 |
| 日志专项 | HTTP→Service→Repository/GORM 请求关联、并发隔离、双数据库敏感哨兵检查、文件轮转及容器输出/停机 |

当前完成结论为**代码与测试环境验收**。真实 AD 加密连接、500+ 用户真实目录规模及不同生产网关需在采用环境另验；人工 VoiceOver/NVDA 实测按此前约定豁免，不能算实测通过。日志专项未重新提供 Live AD 凭据，3 项既有目录测试跳过，双数据库/Redis 的日志相关回归已实际执行。当前没有正式部署验收结论。

本机规模测试不代表生产吞吐或真实目录/网络延迟。现有登录限流为单进程；需要多实例统一限流时需扩展。运行日志与 LDAP 报告已有实现，完整业务审计和集中日志留存需另行接入。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [需求规格](docs/REQUIREMENTS.md) | 产品能力、技术约束和接口约定 |
| [架构与实现](docs/ARCHITECTURE_AND_PLAN.md) | 分层、模型、认证、权限与装配设计 |
| [API 文档](docs/API.md) | 接口、权限、版本控制与实时事件契约 |
| [开发协作规范](AGENTS.md) | 后端/前端编码、日志记录和验证要求 |
| [任务清单](docs/TODOLIST.md) | 已完成任务、证据及后续环境门禁 |
| [Docker 部署](docs/DOCKER.md) | 构建、初始化、持久化及操作命令 |
| [迁移与升级](docs/MIGRATION_OPERATIONS.md) | 数据库迁移、升级和回退操作 |
| [日志使用说明](docs/BACKEND_LOGGING.md) | 日志配置、存放、关联和错误记录 |
| [发布验证记录](docs/RELEASE_VALIDATION.md) | 分阶段实际结果及历史范围说明 |
| [AD 测试环境验收](docs/R14_AD_VALIDATION.md) | 真实目录验证与未覆盖范围 |
| [日志专项验收](docs/BACKEND_LOGGING_VALIDATION.md) | 日志回归、运行环境和输出证据 |

## 脚手架稳定性检查

本轮修复范围和执行状态见 [稳定性方案](docs/SCAFFOLD_STABILIZATION_PLAN.md)、[任务清单](docs/TODOLIST.md)。功能范围冻结，后续以缺陷修复和维护为主。

```sh
make check
# 浏览器依赖只需首次安装或升级 Playwright 后安装
npm --prefix frontend exec -- playwright install chromium
# 真实前后端 + 代理 + 浏览器；自动创建并回收临时 SQLite，不使用开发数据库
npm --prefix frontend run test:integration
```

`make check` 包含后端 race/vet/Go 格式检查、前端 ESLint/类型/单测/构建。完整 `make check-integration` 还要求独立可丢弃的 PostgreSQL/Redis 环境变量，并执行浏览器交互与真实链路；数据库变量与隔离要求见上方测试说明。已有本机 Chrome 可使用 `PW_CHROME_CHANNEL=chrome`。真实链路默认占用 18081（临时后端）和 4175（Vite 代理），不复用已有服务，失败时也清理临时目录。`INFRANEXUS_SMOKE_BASE_URL` 仅用于显式指定独立、可丢弃的测试栈，会创建测试用户并执行退出，不能指向正式环境。CI 定义位于 `.github/workflows/check.yml`，使用独立服务和安装的 Chromium。

就绪探针、可信代理和数据留存策略见 [Docker 部署说明](docs/DOCKER.md)。
