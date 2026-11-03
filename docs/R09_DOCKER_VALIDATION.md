# R09 Docker 集成验收记录

本记录针对本机 Docker 内的 Nginx → InfraNexus → PostgreSQL/Redis 拓扑。正式入口/云负载均衡器配置与本例不同时，需按相同场景复验；不据此宣称 R13 人工读屏或 R14 部署数据核查已完成。

> 验收工具已在后续交付中移除，本文件与证据仅作历史记录。对应源码保留在 Git 提交 `a8c3d56`；当前正式部署方式见 [Docker 部署说明](DOCKER.md)。

## 历史部署与复跑（提交 a8c3d56）

仓库根目录执行：

```sh
python3 deploy/r09/run.py --output /private/tmp/infranexus-r09-evidence
```

历史部署文件和参数位于该提交的 `deploy/r09/README.md`。Compose project 每次唯一，随机凭据仅在运行时传入；测试后自动删除本次容器、网络和临时卷，保留证据文件。原有 Redis 和其他容器不参与故障注入。

- Go 1.27.2 多阶段构建，保留 CGO 的 SQLite/PostgreSQL 双驱动；运行用户为 10001。
- 前端以 Node 24.11.1 构建，由 Nginx 1.29.4 提供页面和 API/SSE 反向代理。
- PostgreSQL 17.11、Redis 8.6.3 为可丢弃服务。
- 仅 `r09audit` 构建启用资源计数端口，绑定宿主机 loopback，不经过网关；普通镜像即使设置诊断环境变量也不开放该端口。
- 故障容器只共享本次网关的网络命名空间，以 NET_ADMIN 注入专用端口的真实 iptables DROP，不修改宿主机防火墙。

## 验收断言

| 场景 | 断言 |
| --- | --- |
| 部署 | 前端入口、健康检查、临时管理员登录成功；预热后采集资源基线。 |
| 断开 5 轮 | 每轮关闭客户端后，SSE writer/Redis Read/Redis 阻塞读取/应用 ESTABLISHED 归零，资源不逐轮增长。TCP FIN 可能经过两次 10 秒心跳写入才能转为可感知写错误，本拓扑设 25 秒回收预算。 |
| 事件恢复 | 保存实际事件 ID；关闭后发布下一事件；重连返回原检查点并补发下一事件，ID 和正文标记均须匹配。 |
| 代理超时/退出 | 独立入口配置 3 秒 proxy_read_timeout；另停止真实网关进程并重启，等待资源恢复。重启使用 --no-deps，避免改变故障范围。 |
| Redis 无响应 | 暂停本次 Redis，SSE 在有界 Read 超时后退出；恢复 Redis 后重新打开流成功。 |
| 慢读/黑洞 | 两条流分别停止读取、双向 DROP；发送 1000 条 32KiB 合成事件，确认 Send-Q > 0 和实际 DROP 包计数 > 0。 |
| 生命周期 | 应用 socket 不超过 120 秒+3 秒采样/调度余量，writer/Read 不超过 133 秒；移除规则后资源恢复，重新连接可收信。 |
| SIGTERM | 保持 5 条 SSE，向实际服务 PID 发送 SIGTERM；10 秒内退出码 0，日志无 forced shutdown，Redis 无该应用阻塞/订阅连接。 |

资源核对使用 runtime goroutine/FD、生产者和 Read 的栈计数、/proc TCP 状态、Redis CLIENT LIST 与应用 PoolStats。共享池并发扩容后保留空闲连接属于预期：必须满足 CLIENT LIST 总数 = 共享池 TotalConns + PubSub Active + 1 个采样连接；不允许独立 XREAD 连接残留。报告同时保留池 Total/Idle，且共享池总数不得超过本次验收设置的 8；goroutine/FD 余量分别为基线+6/+4。

## 最终实测结果（2026-10-23）

完整顺序运行 **Passed**，采集 918 次资源样本，采样阶段约 356 秒。结果与镜像 ID 见 [JSON 证据](evidence/r09-docker-2026-10-23.json)，逐次资源记录见 [CSV 采样](evidence/r09-docker-2026-10-23-samples.csv)。完整原始输出保留于 `/private/tmp/infranexus-r09-final-2`。

| 场景 | 最终结果 |
| --- | --- |
| 客户端主动断开 5 轮 | 20.245 / 20.236 / 20.270 / 20.298 / 20.218 秒回收。 |
| 检查点与补发 | 原检查点保持，重连后下一事件 ID/正文匹配。 |
| Nginx 上游超时 | 3.003 秒关闭。 |
| 网关进程退出 | 20.079 秒资源恢复。 |
| Redis 暂停 | 11.105 秒流退出，恢复后可重新连接。 |
| 真实背压与丢包 | 1000 条×32KiB；DROP 计数 27。完整运行中补充断言分别核对两个 listener 的 Send-Q：慢读 1,367,464B，黑洞 70,952B；同时 writer=2、Read=0，证明两条流均在等待写出。该独立断言也已纳入脚本供后续复跑。 |
| 慢读/黑洞到期 | socket 和 writer/Read 均在 120.320 秒回收；故障恢复后新流可收信。 |
| 最终资源 | writer/Read/应用 ESTABLISHED/Redis blocked/XREAD 均为 0；goroutine 17→17；FD 12→14；共享 Redis 池 Total/Idle 1/1→3/3，PubSub Active 1→1，CLIENT LIST 3→5，独立残留对账为 0。新增两个 FD 对应空闲共享池连接。 |
| 5 条 SSE 下 SIGTERM | 0.314 秒，退出码 0，无 forced shutdown，Redis 阻塞/订阅连接归零。 |
| 普通镜像 | SQLite 健康检查 200，运行用户 10001:10001；设置审计环境变量后诊断端口仍不可用。 |

Docker 29.3.1、Compose 5.1.1，Linux/arm64 容器。正式 Go 回归：`go test -race -count=1 -p=1 ./...` 通过（bootstrap 139.262 秒）；默认/`r09audit` 的 `go vet ./...` 通过；SSE 新回归三轮 race 通过，最终诊断变更后 SSE/目录定向 race 再次通过。

## 本轮修复与证据口径

首次 Docker 预热复现：TCP ESTABLISHED 已归零，但 25 秒后仍有 1 个 SSE writer、1 个 Read 和 1 个 Redis 阻塞连接。新增 `TestSSEBodyCloseCancelsPendingRead` 直接模拟 fasthttp 在写 socket 失败后关闭响应体，旧实现失败，修复后 race 连续三轮通过。

修复将流的 context 与响应体 Close 关联，关闭响应体立即取消待处理 Read，并使用独立的 120 秒流生命周期关闭连接与生产者；Fiber WriteTimeout 与生产者共用同一常量。异步生产者仍不持有 fiber.Ctx。

早期脚本把共享 Redis 池的正常扩容当作泄漏；最终通过 PoolStats 对账，区分共享空闲连接、授权订阅和独立读取连接。早期构建、故障脚本和资源断言失败均未作为通过证据。

最终完整运行结果与镜像身份登记在相邻 JSON 证据文件，详细逐次采样保留在运行输出目录的 report.json。普通镜像另已验证：非 root 启动 SQLite，健康检查 200，诊断端口不存在。Go 全量 race、默认/验收构建的 vet 和 SSE/目录定向 race 均通过；本轮全量 Go 命令未设置外部 PG/Redis 测试环境变量，外部服务专项由 Docker 集成验收单独覆盖，不能把跳过的测试算通过。

首次前端 Docker 构建的 npm ci 审计输出报告 7 项 high 依赖告警，本轮未升级依赖或判断其运行时可利用性；该信息单独保留供发布依赖核查，不作为 R09 连接生命周期验收结果。
