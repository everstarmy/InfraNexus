# Docker 构建与部署

前后端镜像均从仓库根目录构建，使用多阶段构建与非 root 运行用户。后端启用 CGO，保留 SQLite/PostgreSQL 双驱动；编译器、Go SDK 和 Node/npm 不进入运行镜像。

## 构建镜像

```sh
docker build -f backend/Dockerfile -t infranexus/backend:local .
docker build -f frontend/Dockerfile -t infranexus/frontend:local .
# 或：make docker-build
```

需要 Docker BuildKit。前端在构建阶段执行 npm ci 和生产构建，运行镜像使用 Nginx 提供 SPA、静态资源和 /api/ 反向代理。Nginx 通过 Docker DNS 解析 app 服务，关闭 SSE 缓冲，读写超时为 130 秒。两个镜像均有 HEALTHCHECK。

## Compose 部署

```sh
cp .env.example .env
```

在 `.env` 中分别设置随机的 `DB_PASSWORD`、`JWT_SECRET`、`ENCRYPTION_KEY`。每个值可使用下面的命令单独生成；JWT_SECRET 至少 32 字符，不应复用三个值：

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

启动前后端、PostgreSQL 和 Redis：

```sh
docker compose up -d --build --wait
```

示例 `.env` 使用 `APP_ENV=development` 支持本机 HTTP，地址为 `http://localhost:8080`，只绑定宿主机 loopback。需要其他端口时同时修改 `HTTP_PORT` 和 `TRUSTED_ORIGINS`；需要对外监听时设置 `HTTP_BIND`。正式 HTTPS 部署设置 `APP_ENV=production`、实际 HTTPS Origin 和 `SESSION_SECURE=true`；生产模式强制 Secure Cookie，不能用 SESSION_SECURE=false 关闭。TLS 由外层反向代理终止，本配置不包含证书。

首次安装显式初始化管理员：将一次性强口令注入当前 shell 的 `INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD` 环境变量，再执行：

```sh
docker compose run --rm -e INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD app bootstrap-admin
unset INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD
```

该命令只创建缺失的 admin，不重置已有账号，也不把管理员口令保存在常驻 app 容器环境中。修改数据库/JWT/加密配置前应按相应业务流程处理既有数据和会话，不要在每次启动时重新生成密钥。

PostgreSQL 和 Redis 使用命名卷持久化，均不向宿主机发布端口；前端是唯一发布入口。SQLite 单独运行镜像时可将可写卷挂载到 `/app/data`，目录需要允许 UID 10001 写入。

```sh
docker compose ps
docker compose logs -f app frontend
docker compose down
```

`down` 保留数据卷；日常停止不要添加 `--volumes`。

R09 专用故障脚本、诊断接口和构建标签已移除。SSE 生命周期修复及正式回归测试保留，历史验收证据见 [R09 历史记录](R09_DOCKER_VALIDATION.md)。

## 日志

后端输出单行 JSON，应用/访问/SQL 分别使用 category=app/access/sql；`.env` 的 LOG_LEVEL（默认 info）与 SQL_LOG_LEVEL（默认 warn）独立控制。SQL warn 记录错误与慢查询，绑定参数及驱动原始错误详情不输出；Fiber 启动 banner 已关闭。

四服务显式使用 local 日志驱动，max-size=20m、max-file=5。通过 `docker compose logs --since 30m app` 查询；容量轮转不保证固定保留天数或容器删除后的历史留存。直接部署的文件模式、轮转、Service 写法与故障处理见 [日志使用说明](BACKEND_LOGGING.md)。

## 本轮构建验证（2026-10-23）

已实际执行上面的两条 docker build，产出 Linux/arm64 的 `infranexus/backend:local` 和 `infranexus/frontend:local`。隔离 Compose 冒烟通过：四服务健康、SPA 回退/静态资源/404、可信 Origin 的 HttpOnly Cookie 登录、SSE 初始检查点，以及后端重建后的账号/会话保留。测试容器与测试卷已清理，正式镜像保留在本机。结果和镜像 ID 见 [构建证据](evidence/docker-build-2026-10-23.json)。

移除诊断入口后的 handler race 测试和 go vet 通过。Docker Scout 扫描尝试要求 Docker ID 登录，本轮未完成镜像 CVE 扫描；构建与启动验证不代表完整的生产安全验收。

## 可信代理与登录限流（2026-10-24）

后端默认不信任转发头。Compose 为前端 Nginx 分配独立 proxy 网段 `172.30.248.0/28` 和固定地址 `172.30.248.2`，后端只信任这个地址的 `X-Real-IP`；Nginx 覆写该 Header。后端没有发布宿主端口。若网段与采用环境冲突，同时调整网段、Nginx 固定地址和 APP_SECURITY_TRUSTED_PROXIES。多层网关应由最靠近客户端的可信入口正确获取真实地址，不能直接信任客户端提交的 Header。

非 Compose 部署通过 `security.trusted_proxies` 或 `APP_SECURITY_TRUSTED_PROXIES` 设置明确的 IP/CIDR；不得为了通过限流全局信任来源。配置只接受 development/test/production，拼写错误拒绝启动；会话/JWT 有效期必须为正且空闲/访问有效期不得超过绝对/刷新有效期。

Compose 后端固定为 `172.30.248.3`，避免 Docker 动态地址先占用 Nginx 的 `.2`。网段冲突时在 `.env` 同时调整 `PROXY_SUBNET`、`PROXY_FRONTEND_IP`、`PROXY_BACKEND_IP`；后端信任地址随前端 IP 变量同步。

`GET /api/v1/health` 只检查进程存活；`GET /api/v1/ready` 在总计 1 秒预算内检查数据库与已连接的 Redis，生产缺少 Redis 也会失败，返回统一业务码 `503002`。开发模式启动时已回退到内存认证的实例无需 Redis。后端 Docker HEALTHCHECK 使用 `/ready`；Nginx `/__health` 仍为网关存活检查，Compose 的 depends_on 只约束启动顺序，不代表网关会在后端故障时自动下线。

## 临时记录保留

`retention.enabled` 默认 true，`retention.outbox_days` 默认 30，`retention.sync_log_days` 默认 90；环境变量为 APP_RETENTION_ENABLED / APP_RETENTION_OUTBOX_DAYS / APP_RETENTION_SYNC_LOG_DAYS。关闭清理可设 APP_RETENTION_ENABLED=false。保留天数必须为正。

清理在后台任务启动时执行一次，此后每小时执行；每轮分别最多物理删除 100 条已发布 Outbox、100 条已结束的同步报告，单轮总时限 10 秒。大量历史数据分批回收，不保证刚到期限立即删除。pending Outbox、非终态任务、缺结束时间的任务，以及仍被运行中目录配置引用的任务均保留；同步报告按结束时间计算期限，报告中的幂等请求 ID 同期保留。超过窗口后旧任务/旧幂等响应不再可查询，旧预览不能重新执行，必须重新预览并使用新的请求 ID。采用环境如有更长留存需求应先调整配置并备份。过期 LDAP 预览快照另按原有过期时间物理清理，包括过去的软删除记录。
