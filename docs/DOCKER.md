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

## 本轮构建验证（2026-10-23）

已实际执行上面的两条 docker build，产出 Linux/arm64 的 `infranexus/backend:local` 和 `infranexus/frontend:local`。隔离 Compose 冒烟通过：四服务健康、SPA 回退/静态资源/404、可信 Origin 的 HttpOnly Cookie 登录、SSE 初始检查点，以及后端重建后的账号/会话保留。测试容器与测试卷已清理，正式镜像保留在本机。结果和镜像 ID 见 [构建证据](evidence/docker-build-2026-10-23.json)。

移除诊断入口后的 handler race 测试和 go vet 通过。Docker Scout 扫描尝试要求 Docker ID 登录，本轮未完成镜像 CVE 扫描；构建与启动验证不代表完整的生产安全验收。
