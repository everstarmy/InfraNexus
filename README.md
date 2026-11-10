# InfraNexus

InfraNexus 面向银行数据中心的硬件运维与存储网络运维团队，建设**数据中心基础设施与存储网络资产运维管理系统（DCIM + SAN）**。业务范围覆盖机房空间、设备台账与生命周期、维保与备件、物理线路、带外采集、告警工单及 SAN 拓扑分析。

当前代码已提供身份认证、权限、组织管理、目录同步、实时通知和日志等平台底座。业务功能与验收依据 [DCIM + SAN 业务需求规格](docs/DCIM_SAN_REQUIREMENTS.md)，开发顺序统一见 [正式开发路线](docs/DCIM_DEVELOPMENT_ROADMAP.md)。本项目按正式项目建设，已撤销此前 Demo 开发方案。

## 正式开发顺序

基础核对与契约 → 位置管理 → 制造商/供应商 → 组件与设备模型 → IP 管理 → 资产与采购到货 → 生命周期工单 → 合同/备件维修/处置 → 端口与线路 → 正式采集 → 告警闭环 → SAN 与厂商扩展。

基础模块先具备完整管理能力，后续模块按真实依赖集成。位置管理、IP 管理、制造商与供应商的后端已接入迁移、API 和角色权限。资源路径、导入导出和权限编码见 [基础管理 API](docs/DCIM_MANAGEMENT_API.md)。

## 完整业务范围与验收阶段

下表是需求归属，不是另一套开发顺序；1A 的基础、资产、工单和处置跨多个开发批次，完整验收要求不因分批实施而减少。

| 阶段 | 交付范围 |
| --- | --- |
| **1A 台账底座** | 机房空间、机柜 U 位、库房库位、设备型号与台账、主备管理 IP、Excel 导入、扫码入库、生命周期及上架、移机、下架和报废工单 |
| **1B 维保与备件** | 供应商、合同覆盖与到期预警、部件台账、备件库存、盘点、维修领料、坏件还厂与涉密介质处置 |
| **1C 端口与线路** | 设备端口、配线架与 ODF、光缆芯、跳线、路由追踪与查找、跳线工单、标签及导入 |
| **2A 采集骨架** | 控制中心与 mTLS 卫星探针、四类采集任务、错峰调度、立即采集、主备管理入口切换、台账对账与 PostgreSQL 时序存储。首批适配 Brocade FOS、华为 OceanStor 和服务器 Redfish |
| **2B 告警闭环** | SNMP Trap、MIB 解译、成对消警、多来源归并、维护窗口、企业微信／短信／Webhook 通知与告警转工单 |
| **3A 逻辑拓扑** | Brocade Fabric、Zone 与 ISL、华为存储映射、端到端路径、物理与逻辑对账、单点及残留分析和故障影响分析 |
| **3B 厂商扩展** | Dell EMC PowerMax（经 Unisphere）、Unity、PowerStore，NetApp ONTAP 与 StorageGRID |

设计基线约为 2,000 台服务器、50 台存储和 80 台光纤交换机。开发、测试和生产数据库统一使用 PostgreSQL，设备采集仅使用只读 REST API 与 SNMP（含 Trap）。阶段依赖、验收条件和现网待确认事项以业务需求规格为准。

## 已实现的平台底座

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
- **数据库与迁移**：使用 PostgreSQL，支持连接池、版本化迁移与初始化数据；组织调整和授权变更使用事务、版本检查及并发控制。
- **双通道认证**：Web 使用 HttpOnly Session Cookie，支持空闲/绝对有效期；外部客户端使用 Bearer JWT。Header 凭据优先，失效时不回退 Cookie；用户停用、改密及认证版本变更参与凭据校验。
- **RBAC 与多实例一致性**：Casbin v3 控制角色/API 访问，前后端共用有效权限；授权 revision、事务 Outbox、Redis 通知和后台收敛实现跨实例更新。Casbin 中间件为项目适配实现。
- **目录任务可靠性**：绑定密码加密存储；目录请求支持取消和总时限；预览计划、幂等提交、任务租约、进度持久化与过期任务恢复；不完整搜索不会直接作为完整目录执行缺失账号停用。
- **运行日志**：统一 slog，应用/访问/SQL 分类；Service 自动关联请求，后台任务关联任务来源；独立级别、慢查询、SQL 绑定参数保护、标准输出和文件轮转。
- **存储与生命周期**：统一 Fiber Storage 工厂已接入 memory、PostgreSQL、Redis、S3 驱动；提供后台任务管理、资源关闭及 SIGINT/SIGTERM 平滑停机。存储驱动属于基础设施，可供后续业务接入。

## 技术栈

| 层次 | 使用技术 |
| --- | --- |
| 后端 | Go 1.27.2+、Fiber v3、GORM、Casbin v3、Viper、slog |
| 数据与存储 | PostgreSQL、Redis、gorm datatypes、Fiber Storage |
| 前端 | React 19、TypeScript、Vite 8、React Router 7、Axios、React Query |
| UI 与数据展示 | Tailwind CSS v4、shadcn / Base UI、TanStack Table v9、Lucide、Recharts |
| 测试 | Go test / race / vet、Vitest、Playwright、Axe |
| 部署 | 多阶段 Docker 镜像、Docker Compose、Nginx、非 root 运行及健康检查 |

具体依赖版本以 [go.mod](backend/go.mod)、[package.json](frontend/package.json) 和锁文件为准。

## 项目结构

```text
InfraNexus/
├── backend/
│   ├── cmd/server/             # 服务入口与管理员密码恢复命令
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
├── docs/                       # 业务需求、API、部署与组件规范
├── compose.yaml
├── .env.example
├── Makefile
└── AGENTS.md                   # 开发约定与日志记录规范
```

## 本地开发

以下命令均从仓库根目录执行。

### 环境与依赖

需要 Go 1.27.2+、Node.js 22.12+、npm 和 PostgreSQL。前端 Docker 构建使用 Node 24.11.1。

```sh
go -C backend mod tidy
npm --prefix frontend install
```

本地启动前创建 PostgreSQL 数据库，并配置连接凭据。连接与连接池参数都在 `database` 下直接配置。服务启动时执行版本化迁移。开发环境 Redis 不可用时，认证存储可回退进程内模式；要使用 Redis SSE 事件和跨实例能力，需要连接 Redis。生产环境 Redis 不可用会拒绝启动。

本机后端可选用根目录 `.env.local` 配置环境变量；`make dev-backend` 会自动加载该文件。它被 Git 忽略，请勿提交。示例：

```sh
APP_DATABASE_HOST=127.0.0.1
APP_DATABASE_PORT=5432
APP_DATABASE_USER=infranexus
APP_DATABASE_DBNAME=infranexus
APP_DATABASE_PASSWORD='替换为数据库密码'
APP_JWT_SECRET='替换为独立的随机密钥'
APP_SECURITY_ENCRYPTION_KEY='替换为独立的随机密钥'
```

`.env.local` 使用 shell 赋值语法，包含特殊字符的值应加引号。已有本地数据库覆盖配置需改用上述平铺字段和环境变量。Docker Compose 继续使用 `.env`。

### 初始化管理员

系统没有默认登录密码。首次启动前后端后，打开前端页面会自动进入 `/setup` 初始化页：

1. 管理员账号固定为 `admin`，输入初始密码并再次确认。
2. 密码至少 8 位，包含大写字母、小写字母、数字、符号中的至少 3 类，且不超过 72 字节。
3. 创建成功后进入登录页，使用 `admin` 和刚设置的密码登录。

已有管理员时自动跳过初始化，重复调用初始化 API 返回 403。状态查询失败会显示重试，管理员停用、移除角色或软删除不会重新开放初始化。普通重启、镜像更新和数据库迁移不会重置已有密码。

服务不会创建带公开默认密码的账号，首次初始化统一通过页面完成。需要恢复或轮换已有内置管理员密码时，通过运行环境注入一次性的 `INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD` 强口令后执行：

```sh
go -C backend run ./cmd/server rotate-admin-password
unset INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD
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
| `database.dsn` | `APP_DATABASE_DSN` | 可选 PostgreSQL 连接字符串，优先于分项连接配置 |
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

在 `.env` 中设置相互独立的部署凭据。这些值用于后端服务，管理员登录密码在初始化页面单独设置。

| `.env` 变量 | 用途与要求 |
| --- | --- |
| `DB_PASSWORD` | PostgreSQL 账号密码，不能为空；Compose 同时传给数据库容器和后端 |
| `JWT_SECRET` | JWT 签名密钥；生产环境至少 32 字节，不能使用默认值 |
| `ENCRYPTION_KEY` | LDAP/AD 服务账号绑定密码的加密密钥，至少 16 字节；生产环境不能使用默认值 |

普通英文字母、数字和英文符号每个占 1 字节。建议为三个变量分别生成随机值并安全保存，后续部署沿用原值：

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

配置完成后启动：

```sh
docker compose up -d --build --wait
```

Compose 启动前端 Nginx、后端、PostgreSQL 和 Redis；默认入口为 [http://localhost:8080](http://localhost:8080)，只绑定宿主机 loopback。PostgreSQL/Redis 使用持久卷且不向宿主机发布端口，前端通过 Nginx 代理 API/SSE。

首次部署完成后，打开前端页面为 `admin` 设置初始密码；已有账号会自动进入正常登录流程。首次创建统一使用页面，旧 `bootstrap-admin` 命令已移除。

已有 PostgreSQL 数据卷时，修改 `.env` 的 `DB_PASSWORD` 不会自动修改数据库账号密码，轮换时必须同步更新数据库中的实际密码。`ENCRYPTION_KEY` 应与数据库备份一同安全保存，修改后原有目录绑定密码将无法解密，需要恢复旧密钥或重新填写目录绑定密码。

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

数据库测试使用独立 PostgreSQL 实例，测试角色需要有创建 schema 的权限。每个用例在专用 schema 中运行并清理。Redis 集成也需要独立实例。运行 race 检测需要 CGO 和 C 编译工具链。将以下变量指向可丢弃的测试环境后执行检查。

```sh
export INFRANEXUS_TEST_POSTGRES_DSN='postgres://<user>:<password>@127.0.0.1:5432/<isolated_test_db>?sslmode=disable'
export INFRANEXUS_TEST_REDIS_ADDR='127.0.0.1:<isolated_redis_port>'
make check-backend
```

前端单测、构建、浏览器与性能回归：

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
npm --prefix frontend run test:perf
```

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [正式开发路线](docs/DCIM_DEVELOPMENT_ROADMAP.md) | 基础管理优先、模块依赖、B0～B11 开发顺序及交付要求 |
| [DCIM + SAN 业务需求规格](docs/DCIM_SAN_REQUIREMENTS.md) | 项目范围、前置验证、七个业务阶段的依赖及验收条件 |
| [领域数据模型规格](docs/DOMAIN_ER_MODEL.md) | 涵盖 DCIM、IPAM、资产工单、备件库存、布线路由、采集监控与 SAN 拓扑的完整 ER 模型与数据字典 |
| [开发协作规范](AGENTS.md) | 分层架构、开发约定和验证要求 |
| [API 文档](docs/API.md) | 平台接口、权限与实时事件契约 |
| [Docker 部署](docs/DOCKER.md) | 构建、初始化、持久化及操作命令 |
| [迁移与升级](docs/MIGRATION_OPERATIONS.md) | 数据库迁移、升级和回退操作 |
| [日志使用说明](docs/BACKEND_LOGGING.md) | 日志配置、存放、关联和错误记录 |
| [日志专项验收](docs/BACKEND_LOGGING_VALIDATION.md) | 日志回归、运行环境和输出证据 |
| [数据表格使用手册](frontend/src/components/data-table/README.md) | DataTable 接入与使用约定 |

## 平台集成检查

```sh
make check
# 浏览器依赖只需首次安装或升级 Playwright 后安装
npm --prefix frontend exec -- playwright install chromium
# 真实前后端 + 代理 + 浏览器；需要 Docker，自动创建并回收独立 PostgreSQL 容器
npm --prefix frontend run test:integration
```

`make check` 包含后端 race/vet/Go 格式检查、前端 ESLint/类型/单测/构建。完整 `make check-integration` 还要求独立可丢弃的 PostgreSQL/Redis 环境变量，并执行浏览器交互与真实链路；数据库变量与隔离要求见上方测试说明。已有本机 Chrome 可使用 `PW_CHROME_CHANNEL=chrome`。真实链路默认占用 18081（临时后端）和 4175（Vite 代理），不复用已有服务，失败时也清理临时目录。`INFRANEXUS_SMOKE_BASE_URL` 仅用于显式指定独立、可丢弃的测试栈，会创建测试用户并执行退出，不能指向正式环境。CI 定义位于 `.github/workflows/check.yml`，使用独立服务和安装的 Chromium。

就绪探针、可信代理和数据留存策略见 [Docker 部署说明](docs/DOCKER.md)。
