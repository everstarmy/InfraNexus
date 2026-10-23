# R09 Docker 集成验收

从仓库根目录运行（需要 Docker Compose、Python 3；首次需要拉取镜像和安装构建依赖）：

```sh
python3 deploy/r09/run.py --output /private/tmp/infranexus-r09-evidence
```

脚本使用唯一 Compose project，生成一次性口令，构建前端和后端，然后部署 PostgreSQL、Redis、Go 应用与 Nginx。测试结束（含断言失败）关闭本次 project 并删除临时卷，不操作其他容器或部署数据。重复执行请使用不同证据目录。默认占用的宿主机端口均绑定 127.0.0.1：18880（前端/API）、18881（3 秒代理超时）、18882（黑洞专用入口）、16389（隔离 Redis）、19091（资源诊断）。可通过相应 R09_HTTP_PORT / TIMEOUT_PORT / BLACKHOLE_PORT / REDIS_PORT / DIAGNOSTIC_PORT 环境变量覆盖。

`backend/Dockerfile` 默认构建无诊断接口的普通服务，启用 CGO 以保留 SQLite/PostgreSQL 双驱动；编译器仅存在于构建阶段。验收 Compose 显式设置 `GO_TAGS=r09audit`，才编译只返回资源计数的诊断接口。该端口不经过 Nginx，不能使用验收镜像替代正式发布镜像。

验收过程：

1. 检查前端静态入口、API 健康状态、临时管理员登录。
2. 预热后记录 goroutine、FD、应用 ESTABLISHED 连接、SSE writer、Redis Read 栈及 Redis CLIENT LIST 基线。
3. 连接/主动断开 5 轮，每轮以 25 秒预算等待资源恢复（TCP FIN 检测可能需要两次 10 秒心跳写入）；检查 cursor 重连和已存储事件补发。
4. 通过专用 Nginx listener 的 3 秒 proxy_read_timeout 验证代理超时；终止并重新启动网关验证连接中断。
5. 暂停本次 Redis 容器，验证阻塞读取失败/超时使流退出；恢复后重新连接。
6. 两条流分别停止读取、使用真实 iptables DROP 双向丢弃专用 8082 端口流量；发送 1000 条 32KiB 合成事件，检查真实 TCP Send-Q 和 DROP 计数。规则仅在本次网关容器 network namespace 内，故障工具只具有该容器环境的 NET_ADMIN，绝不修改宿主机防火墙。
7. 观测应用 socket 最大寿命 120 秒（采样/调度容差 3 秒），异步 writer/Redis Read 退出最多再加一个 10 秒读取周期（总预算 133 秒）。Nginx send_timeout 为 130 秒。恢复规则和客户端后，计数须回到基线，无持续积累。
8. 同时保持 5 条 SSE，向真实应用进程发送 SIGTERM；必须在 main.go 的 10 秒预算内以 0 退出，Redis 不保留应用阻塞/订阅连接。

资源基线断言：SSE writer、Redis Read、应用 ESTABLISHED 和 Redis 阻塞读取均为 0；goroutine ≤预热基线+6，FD ≤基线+4，共享 Redis 池总连接 ≤本次设置的 8，并严格核对 CLIENT LIST 总连接 = 共享池 TotalConns + 授权 PubSub Active + 1 个采样连接；独立 XREAD 连接不能残留。Total/Idle 同时记录，避免把池的正常并发扩容误判为泄漏。报告保留每次采样，可检查是否有逐轮增长，而不是只检查单个进程最终退出。

输出包括 `report.json`（实际断言、时间和资源采样）、`services.log`（口令检查后的服务日志）、`compose-build.log`。脚本不会输出或保存生成的凭据。Buildx 状态写入证据目录下的 `.buildx`，避免改动用户全局构建配置。

本套测试证明上述本地 Docker/Nginx 拓扑的 R09 行为。云负载均衡器或不同网关配置需要按同样场景再次验证；本测试不执行 AD 写入，不替代 R13 人工读屏或 R14 部署数据盘点。
