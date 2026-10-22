# M6 最终验证与发布准备记录

> 深度复审更新（2026-10-22）：本文件是 M6 当时的验证记录，保留原始结果供追溯。后续定向审计已复现授权数据竞争、LDAP 原子性/缓存/JIT、订阅释放与 SSE 客户端边界缺陷，当前评级调整为 **Needs Fixes**。本文件的历史通过不能替代新增场景验收；当前改造与发布门禁见 [深度复审整改方案](DEEP_REVIEW_REMEDIATION_PLAN.md)，进度见 [TODOLIST](TODOLIST.md)。

验证日期：2026-10-22。结论：M6 的代码级、数据库级、浏览器级和性能基线验收已完成，可进入隔离 Staging 验证。生产开放前仍需完成本文末尾列出的环境相关检查；本记录不表示已连接生产数据库或真实 LDAP 目录。

## 固定验证环境

| 组件 | 版本 / 规格 |
| --- | --- |
| 主机 | MacBook Pro，Apple M3 Pro，36 GB RAM |
| 操作系统 | macOS 27.0.1，arm64 |
| 后端 | Go 1.27.2 |
| 数据库 / 缓存 | 临时 Docker PostgreSQL 17.11、Redis 8.6.3 |
| 前端 | Node.js 24.11.1、npm 11.6.2 |
| 浏览器 | Playwright Chromium 156.0.8078.4，devicePixelRatio 1 |

PostgreSQL、Redis、LDAP 迁移与备份恢复均使用可丢弃的本地服务和测试数据；未使用部署环境连接信息。

## 验收结果

| 范围 | 结果 |
| --- | --- |
| Go 完整竞争检测 | 通过：`go test -race -count=1 -p=1 ./...`，提供隔离 PostgreSQL DSN 和 Redis 地址；SQLite 用例、PG 迁移/并发用例和 Redis 跨实例用例均参与运行，134 个测试/子测试通过，无 race detector 报告。 |
| Go 静态检查 | 通过：`go vet ./...`。 |
| 真实数据库与实时通道 | PostgreSQL 17 的旧 LDAP 日志/计划迁移保留 `request_id`、数据行和幂等索引；部门双向移动、删除/调岗与 LDAP 建部门交错并发通过。Redis 8 的 Stream 回放/保留缺口和跨实例授权通知通过。 |
| 前端单测与构建 | Vitest 5 个文件、17 个测试通过；生产构建通过。Vite 仍报告一个 522.54 kB 原始大小（166.49 kB gzip）的入口 JS chunk 超过 500 kB 建议线。 |
| 浏览器回归 | Playwright 22/22 通过；六个管理模块在 API 500 错误态下覆盖 320、768、1440、2560 px，无横向溢出，并验证主题切换、减少动态效果、键盘焦点与页面错误。 |
| 自动无障碍扫描 | Axe 扫描六个模块的浅色错误态无违规；浅色和深色主题均无 serious/critical WCAG 2 A/AA、2.1 A/AA 违规。它不替代人工读屏检查。 |
| 浏览器诊断观察 | 回归期间 Vite 收到一次 `ResizeObserver loop completed with undelivered notifications`，但 Playwright `pageerror` 为空且用例通过；Base UI 另对侧栏折叠面板报告 transition 与 animation 同时存在的开发态提示。两项不阻断本轮矩阵，但应在目标浏览器复核侧栏反复展开/收起时的控制台与布局稳定性。 |
| LDAP 迁移备份恢复 | PostgreSQL custom dump 通过 `pg_restore --list`，恢复到另一隔离数据库后，授权状态、目录配置、同步任务计数各为 1；旧版 SQLite/PG 存量升级另由迁移测试覆盖。 |

### 性能基线

前端数据使用受控 Playwright API mock，报告的是浏览器端装载/交互时间，不包含真实 HTTP 网络、LDAP 服务器响应或生产 PostgreSQL 延迟。表格和预览结果为单轮本地基线；树搜索与预览过滤 p95 基于 20 次输入采样。

| 场景 | 观测结果 |
| --- | --- |
| 用户表最大页 | 100 行；从每页 10 行切换到 100 行后 315 ms 完成，页面 5,043 DOM 元素。 |
| 部门树 1,000 节点 | 1,119 ms 首次渲染；20,614 DOM 元素；观测到 285/128/113 ms 长任务；搜索 p50 11.3 ms、p95 16.7 ms。 |
| 部门树 10,000 节点 | 7,536 ms 首次渲染；200,614 DOM 元素；观测到 2,891/1,201 ms 长任务及 127/109/63/53 ms 长任务；搜索 p50 12.5 ms、p95 22.1 ms。 |
| LDAP 预览 500 条 | 页面只渲染 50 行；预览 UI 106.7 ms 就绪；过滤 p50 9.1 ms、p95 12.1 ms。 |
| PostgreSQL 授权 revision 查询 | 100 次：均值 224 µs、p50 190 µs、p95 324 µs。 |
| PostgreSQL LDAP lease 进度快照写入 | 100 次：均值 774 µs、p50 671 µs、p95 1,541 µs。 |
| Redis SSE 事件发布并读取 | 100 次：均值 548 µs、p50 489 µs、p95 737 µs。 |

搜索响应满足候选 p95 <100 ms；10,000 节点树的首屏长任务和 DOM 量明显不达交互目标。P3 虚拟化门槛评估已完成：在需要服务超过约 1,000 个部门的租户前，应将已展开可见树节点扁平化并虚拟渲染，同时保留键盘树语义、搜索定位和拖拽目标。当前实现尚未虚拟化，不对 10,000 节点树作可用性承诺。100 行用户表与 500 条预览在本机基线内可接受。

## 运行命令

下列 PostgreSQL 与 Redis 地址必须是空白、隔离、可丢弃的测试服务；完整命令和 Playwright 首次安装说明见 [README](../README.md)。

```sh
cd backend
INFRANEXUS_TEST_POSTGRES_DSN='postgres://<user>:<password>@127.0.0.1:5432/<isolated_test_db>?sslmode=disable' \
INFRANEXUS_TEST_REDIS_ADDR='127.0.0.1:6379' \
go test -race -count=1 -p=1 ./...
go vet ./...
```

后端 PostgreSQL/Redis 组件性能采样（仍使用隔离、可丢弃的测试服务）：

```sh
cd backend
INFRANEXUS_TEST_POSTGRES_DSN='postgres://<user>:<password>@127.0.0.1:5432/<isolated_test_db>?sslmode=disable' \
INFRANEXUS_TEST_REDIS_ADDR='127.0.0.1:6379' \
go test ./internal/repository -run '^$' -bench '^BenchmarkM6' -benchtime=100x -count=1 -benchmem
```

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:e2e
npm --prefix frontend run test:perf
```

数据库升级备份、前向修复和回退原则见 [数据库迁移与升级操作](MIGRATION_OPERATIONS.md)。API、LDAP 冲突和 SSE 契约见 [API.md](API.md)。

## 进入生产前仍需环境负责人完成

- 用部署环境对应的 LDAP/AD 测试目录验证 TLS 证书、Base DN、属性映射及全量/增量计划执行；本轮只使用确定性 LDAP 测试服务和 API mock。
- 使用目标环境的备份存储与数据库版本执行恢复演练，并验证恢复后轮换凭据或提升 `auth_version` 的步骤；本轮 dump/restore 使用本机临时 PostgreSQL。
- 在真实网关/负载均衡器演练关闭写入口的操作开关。仓库未包含可供本地演练的生产网关，不能把应用二进制回退和数据库降级当作安全回滚。
- 用 VoiceOver 或 NVDA 人工检查登录、数据表格、授权对话框的读屏顺序与状态播报。
- 若租户会管理数千个部门，先完成部门树虚拟化并重新跑 1,000/10,000 节点基线；当前 10,000 节点样本已证实存在秒级主线程阻塞。
