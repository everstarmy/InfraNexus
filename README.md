# InfraNexus - 企业级云原生全栈敏捷开发脚手架

[![Go](https://img.shields.io/badge/Go-1.27+-00ADD8?style=flat&logo=go)](https://go.dev/)
[![Fiber](https://img.shields.io/badge/Fiber-v3-00ACD7?style=flat&logo=gofiber)](https://gofiber.io/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**InfraNexus** 是一套开箱即用的现代化企业级 SaaS 工作台脚手架。
后端基于 **Go 1.27+ / GoFiber v3 / GORM / Casbin v3 / Redis**，前端基于 **React 19 / Vite 8 / Tailwind CSS v4 / @base-ui/react / TanStack Table v9**。

---

## 🌟 核心特性与架构亮点

### 1. 后端工程 (Go 1.27+ / Fiber v3)
- **极简薄入口与依赖注入**：`cmd/server/main.go` 保持薄装配，严格遵循 `Handler -> Service -> Repository` 3 层解耦与接口抽象。
- **全局 UUID 主键**：数据表主键全面采用 UUID（`github.com/google/uuid`），通过 `BeforeCreate` 钩子自动发号，降低顺序 ID 枚举风险。
- **GORM 双引擎驱动与 JSONB 强类型**：
  - 同一套模型兼容 **PostgreSQL**（原生 `uuid` 与高效 `jsonb` 索引）与 **SQLite**（本地单文件免运维）。
  - 集成 `gorm.io/datatypes`，使用 `datatypes.JSONType[T]` 泛型强类型映射个性化偏好配置。
- **认证双通道体系 (Dual-Channel Auth)**：
  - **Web 端 SaaS 工作台**：采用 `HttpOnly + Secure + SameSite=Lax` Session Cookie，避免脚本直接读取 Cookie，服务端滑动窗口自动静默续签。
  - **开放 API / CLI 工具**：采用 `Authorization: Bearer <JWT>`，使用令牌族支持撤销。
- **统一响应模型与领域业务状态码**：
  - 泛型包装 `response.Success[T](c, data)`、`response.Page[T](c, items, total, page, pageSize)` 与 `response.Error`。
  - 业务 `code` 与领域状态强挂钩（如 `200000` 成功，`400001` 参数错误，`401001` 凭据过期，`403001` Casbin 权限阻断等）。
- **细粒度 Casbin RBAC**：基于 `(Role, Path, Method)` 动态策略模型与 GORM 适配器，授权变动实时生效；菜单 → 按钮 → API 三级权限点差量同步为策略，`POST /api/v1/permissions/sync` 扫描已注册路由并修复策略漂移。
- **组织架构与人员调动**：部门树（TreePath 物化路径，最多 15 级）、负责人与排序、子部门/成员删除保护；`POST /api/v1/users/batch-move-department` 事务化批量调岗。
- **AD / LDAP 目录集成与多源认证**：基于 `go-ldap/v3` 的连接测试、同步预览、手动全量/增量同步与按间隔定时全量同步，OU 自动映射部门树；登录支持本地账号与企业域账号，首次域登录自动建档（JIT），域认证失败统一返回 `401002`。
- **实时事件推送 (SSE)**：基于 GoFiber v3 `SendStreamWriter` 实现 Server-Sent Events 长连接通知中心。

### 2. 前端工程 (React 19 / Tailwind CSS v4 / Base UI)
- **SaaS 全宽流式自适应画布 (Full-width Fluid Canvas)**：
  - 核心工作区采用流式铺满设计，超宽屏（2K/4K/带鱼屏）绝不居中受限收窄；移动端自适应抽屉式侧栏。
- **Base UI 12 列代码网格**：
  - 全面使用 `@base-ui/react` 原语体系与 Tailwind CSS v4 现代化 `@theme` 样式系统。
- **企业级数据表格 (TanStack Table v9)**：
  - 深度集成高级数据表格，提供多列头排序、客户端/服务端分页、Faceted 标签筛选、动态列显隐与骨架屏。
- **Web Cookie 会话**：
  - 启动时调用 `/auth/me` 校验身份；401 清理内存身份，网络错误可重试。外部客户端通过 `/auth/token` 获取 JWT。

---

## 📁 目录结构概览

```
InfraNexus/
├── backend/                        # Go 后端工程
│   ├── cmd/server/main.go          # 薄入口主程序 (配置加载, 依赖装配, Graceful Shutdown)
│   ├── internal/
│   │   ├── bootstrap/              # 启动器 (DB 双驱动, Redis, Casbin, Fiber 装配)
│   │   ├── config/                 # Viper 集中配置
│   │   ├── core/                   # 核心通用设施 (logger, response, errors, validator)
│   │   ├── domain/                 # 领域实体模型与接口定义 (User, Department, Role, Permission, LDAP)
│   │   ├── handler/                # HTTP 接入层 (Auth, Users, Departments, Roles, Permissions, LDAP, SSE)
│   │   ├── middleware/             # 中间件 (RequestLog, DualAuth, CasbinRBAC)
│   │   ├── repository/             # 持久化层 (BaseRepository 泛型仓储, UserRepo, RoleRepo)
│   │   ├── service/                # 业务逻辑层 (Auth, Users, Departments, Roles, Authz, LDAP)
│   │   └── storage/                # Fiber Storage 统一驱动工厂
│   ├── config.yaml                 # 默认配置文件
│   └── go.mod
├── frontend/                       # React 19 前端工程
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                 # Base UI 原子组件 (Button, Input, Dialog, DropdownMenu...)
│   │   │   └── data-table/         # TanStack Table v9 企业级数据表格套件
│   │   ├── layouts/                # SaaS 工作台布局 (Sidebar, Header, Full-width Main)
│   │   ├── pages/                  # 业务路由页面 (Login, Dashboard, Users, Departments, Roles, Permissions, LDAP)
│   │   ├── services/               # Axios 实例与 API (Cookie 会话请求)
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── Makefile                        # 快捷运维指令
├── REQUIREMENTS.md                 # 需求规格说明书
├── AGENTS.md                       # AI 智能体开发规范与协作指南
├── ARCHITECTURE_AND_PLAN.md        # 具体系统架构与工程实现方案
└── TODOLIST.md                     # 开发任务追踪看板
```

---

## 🚀 快速启动指南

### 1. 前置环境要求
- **Go**: 1.27+
- **Node.js**: 20+ (推荐 22+) 与 npm

### 2. 启动后端开发服务
```bash
# 方式 A：使用根目录 Makefile
make dev-backend

# 方式 B：手动进入 backend 目录
cd backend
go run cmd/server/main.go
```
> **提示**：默认采用 SQLite 驱动（自动在 `backend/data/infranexus.db` 创建数据文件），无需预先安装外部数据库即可直接启动！服务监听端口为 `http://127.0.0.1:8080`。

### 3. 启动前端开发服务
```bash
# 方式 A：使用根目录 Makefile
make dev-frontend

# 方式 B：手动进入 frontend 目录
cd frontend
npm run dev
```
> 前端默认访问地址为 `http://127.0.0.1:5173`。

### 4. 默认管理员登录凭据
- **用户名**：`admin`
- **初始密码**：`admin123456`

---

## 🧪 自动化测试验证

运行后端单元测试与完整 E2E 认证生命周期集成测试：
```bash
# 运行全部测试
make test

# 或进入 backend 目录指定测试
cd backend
go test -v ./internal/bootstrap
```

构建前端生产 Bundle 并运行前端单元测试：
```bash
make build-frontend
npm --prefix frontend test
```

---

## 📑 核心文档索引
- [需求规格说明书 (REQUIREMENTS.md)](docs/REQUIREMENTS.md)
- [AI 智能体开发规范与协作指南 (AGENTS.md)](AGENTS.md)
- [具体系统架构与实现方案 (ARCHITECTURE_AND_PLAN.md)](docs/ARCHITECTURE_AND_PLAN.md)
- [问题处理与前端交互改造方案（2026-10-22）](docs/REMEDIATION_AND_UX_PLAN.md)
- [任务跟踪看板 (TODOLIST.md)](docs/TODOLIST.md)

## 认证部署配置
`security.trusted_origins` 是可携带凭据的精确 Web 来源列表，同时用于 Cookie 写请求的 Origin/Referer 校验；不得使用 `*`。生产 `session.secure` 强制为 true，建议经 HTTPS 同源部署。`session.max_age` 为空闲有效期，`session.absolute_max_age` 为绝对有效期。登录/Token 获取限流为单进程实现，多实例需另行部署分布式限流。浏览器只使用 Cookie；CLI 使用 `/api/v1/auth/token`、`/api/v1/auth/refresh` 和 Bearer Header。注销只撤销当前会话或令牌族。

`security.encryption_key` 用于 AES-GCM 加密 AD/LDAP 绑定密码，production 环境拒绝空值或默认开发密钥（可用 `APP_SECURITY_ENCRYPTION_KEY` 注入），更换密钥后需重新录入绑定密码。`ldap.scheduler.enabled` / `ldap.scheduler.tick_seconds` 控制定时同步调度器；同步任务通过数据库条件更新（CAS）抢占 `sync_status`，多实例共享数据库时同一配置不会并发同步，超过 2 小时未结束的锁视为失效。
