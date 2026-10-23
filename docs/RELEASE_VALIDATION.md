# M6 最终验证与发布准备记录

## 2026-10-23 后端日志专项

L01–L08 完成本地验收：Context 自动关联、Service/任务日志、SQL 参数保护、独立级别、文件轮转与停机、Compose local logging 已实施。全量 Go race 的 200 项测试事件通过（含子用例），go vet、双数据库/真实 Redis、Docker 构建与输出/停机冒烟通过；3 项 Live AD 测试未提供凭据而跳过。详细命令、覆盖与限制见 [日志验证](BACKEND_LOGGING_VALIDATION.md) 和 [结构化证据](evidence/backend-logging-2026-10-23.json)。未进行正式部署，不替代既有生产门禁。


> 深度复审更新（2026-10-22）：本文件是 M6 当时的验证记录，保留原始结果供追溯。后续定向审计已复现授权数据竞争、LDAP 原子性/缓存/JIT、订阅释放与 SSE 客户端边界缺陷，当时评级调整为 **Needs Fixes**。本文件的历史通过不能替代新增场景验收；当前改造与发布门禁见 [深度复审整改方案](DEEP_REVIEW_REMEDIATION_PLAN.md)，进度见 [TODOLIST](TODOLIST.md)。

## 2026-10-23 R13/R14 测试环境收口（最新结论）

用户明确要求 R13 无障碍人工实测豁免，并确认“尚无正式部署，本轮按测试环境验收”。因此本轮看板在该范围内完成；人工读屏未实测，历史部署数据核查不适用，不宣称生产 Ready for Release。后续章节中的 Needs Fixes 与未完成状态保留为当时记录，以本节范围声明为准。

使用新授权测试 AD 实测：RootDSE、服务绑定、有效账号认证、每页 2 条的真实分页（5 用户、3 页）通过；SQLite 与 PostgreSQL 下 3 并发 JIT→1 档案、即时撤权、预览无写入、任务幂等、全量/增量同步及真实 HTTP/Redis SSE 补发通过。只读事务核查策略、默认角色、部门引用和任务计数，最终异常均为 0。AD 端仅绑定/查询，没有写操作。

核查发现快速同步任务因 500ms 进度节流，成功终态仍保存旧 processed。已修复终态无条件写入实际 processed/total；固定时钟测试在修复前失败，修复后成功、部分失败、取消三种场景 race 三轮通过。真实 AD SQLite/PostgreSQL 链路重新执行后全部通过。

StartTLS 声明支持但带证书校验的升级未成功，未使用跳过校验；本轮只验收指定的 LDAP 模式。实际 500+ 用户加密目录、不同生产网关仍须采用时另验。详细结果、复跑方式与限制见 [R14 报告](R14_AD_VALIDATION.md)、[结构化证据](evidence/r14-ad-2026-10-23.json)。最终后端全量 `go test -race -count=1 -p=1 ./...` 与 `go vet ./...` 通过（外部集成变量未设置，真实 AD 双数据库另行显式执行）。后端正式 Docker 镜像重新构建通过。专用测试容器与临时数据库口令已清理。本轮没有重跑前端测试，既有前端验收证据沿用，前端源码未变。

## 2026-10-23 常规 Docker 镜像交付

按要求移除 R09 专用容器编排、故障工具、诊断端点及构建标签，保留 SSE 修复、正式回归和历史验收证据（工具源码归档于 `a8c3d56`）。新增正式前端 Dockerfile/Nginx 配置与根 Compose；后端保留非 root、CGO 双数据库驱动和健康检查。实际 docker build 已产出 `infranexus/backend:local`、`infranexus/frontend:local`，Linux/arm64。

隔离正式 Compose 冒烟通过：四服务健康、SPA/资源/404、Origin 校验和 Cookie 登录、SSE 检查点、后端重建后的账号/会话持久化，以及无诊断入口。生产模式强制 Secure Cookie 的逻辑保留；示例环境明确采用本机 HTTP 开发模式，正式 HTTPS 切换 production。handler race 与 go vet 通过。Docker Scout 因需要 Docker ID 登录未完成扫描。部署步骤见 [Docker 文档](DOCKER.md)，镜像和结果见 [构建证据](evidence/docker-build-2026-10-23.json)。本节不改变 R13/R14 的未完成状态。

## 2026-10-23 R09 Docker 网关与故障验收

R09 现已达到本地 Docker/Nginx 拓扑的验收标准，详情见 [完整报告](R09_DOCKER_VALIDATION.md)、[镜像/结果证据](evidence/r09-docker-2026-10-23.json) 和 [918 次资源采样](evidence/r09-docker-2026-10-23-samples.csv)。使用 PostgreSQL 17.11、Redis 8.6.3、Nginx 1.29.4，多阶段构建完整前后端；真实容器 iptables DROP 与停止读取均形成背压。未修改现有 Redis 或 AD。

本轮复现并修复响应体关闭未取消 SSE 生产者的问题；正式回归旧实现失败、修复后 race 三轮通过。每条流增加独立 120 秒 context，与 socket 寿命共用常量。最终完整顺序运行通过：五轮断开约 20.2 秒，代理超时 3.003 秒，网关退出回收 20.079 秒，Redis 暂停后 11.105 秒关闭流，慢读/黑洞 120.320 秒回收，5 条 SSE 的 SIGTERM 退出 0.314 秒。事件 ID/正文补发断言通过。普通镜像保持 SQLite/PostgreSQL 支持、非 root 运行，诊断端口不编译启用。

最终 writer/Redis Read/阻塞读取/应用 ESTABLISHED 均为 0，goroutine 17→17；共享 Redis 池 1/1→3/3（Total/Idle），解释 FD 12→14 和 CLIENT LIST 3→5，独立连接残留为 0。不能把池的正常并发扩容误报为泄漏，也不能只凭进程退出推断运行时回收成功。Go 全量 race 及默认/验收构建 vet 通过；本次全量未设置外部 PG/Redis 单测变量，Docker 实际服务链路另验。

当前仍为 **Needs Fixes**：R13 人工读屏、R14 部署数据核查/实际目录加密与规模验证尚未完成；不同实际网关配置需复验。以下各节的未完成描述保留其当时历史范围。

## 2026-10-23 真实 AD 与隔离应用链路补验

基于 `bcb7476`，使用用户明确授权的 AD 测试目录。AD 端仅绑定、认证和查询；用户、角色、任务和缺失账号停用均发生在临时 SQLite 数据库，Redis 为专用一次性服务，未修改 AD 条目、现有应用配置或部署数据。凭据仅通过运行时环境提供，不写入仓库和报告。

新增显式启用的正式测试 `backend/internal/bootstrap/ldap_live_test.go`：

| 范围 | 实测结果 |
| --- | --- |
| 目录网关 | `TestLiveADGatewayReadOnly`：服务账号绑定、正确密码认证、AD 属性/GUID 映射和分页搜索 API 通过；5 个用户，3 启用/2 停用，身份无重复，约 68ms。目录只有 5 人，本轮未触发真实跨页。 |
| HTTP 身份与授权 | `TestLiveADIsolatedApplicationLifecycle`：3 次同时有效登录全部成功，应用只产生 1 个完整 AD 档案与默认角色；角色撤权后 3 个已签发令牌均收到 403。未做错误密码探测。 |
| 预览与任务 | 全量预览不写用户；创建 2 个启用用户并停用 1 个仅存在于临时库的合成缺失账号，停用递增 AuthVersion；相同幂等键返回相同任务；再次全量预览 create/update/disable 均为 0，增量预览无新增或缺失停用。 |
| SSE | 真正的 HTTP 流收到 started/finished；关闭后使用原 cursor 重连，返回同一 finish 事件 ID；Redis 存储参与实际读写。 |
| 凭据保护 | API 无 bind_password/口令；临时库绑定口令为 v1 密文；应用日志不含绑定口令、管理员或 AD access token。 |
| 新发现与修复 | 首次核心断言通过但 shutdown 超过 3 秒。独立真实 Redis 回归复现 context 取消后 XREAD 仍阻塞。阻塞 Read 改用专用单连接池，取消时关闭该池，返回原 context 错误，保留共享认证/发布客户端。`TestRedisEventStoreCancellationReleasesBlockedRead` 三轮、每轮 5 次取消后均在 1 秒内返回，CLIENT LIST 连接数恢复基线。每次阻塞读取会重新建连，其 TLS/高连接数开销仍需目标规模验证。 |
| SSE 基准 | 同一隔离 Redis，`BenchmarkM6RedisSSEPublishAndDeliveryRead` 100 次：均值约 2.02ms/op、p50 1.69ms、p95 3.41ms，82.7KB/op、347 allocs/op；包含专用池重新建连，非目标网关/多订阅者压测。 |
| 最终结果 | 两项真实 AD 测试使用 `-race -count=1` 均通过，合计约 3.4 秒，应用在 3 秒 shutdown 预算内退出。设置隔离 Redis 地址后，`go test -race -count=1 -p=1 ./...` 全量通过（bootstrap 143.117 秒），`go vet ./...` 通过。本次全量覆盖 SQLite/真实 Redis，未设置 PostgreSQL DSN，PG 专项跳过；真实 AD 两项另以上述显式环境变量独立执行并通过。首次 fixture 未配置 TrustedOrigins 导致的启动失败，以及修复前停机失败，均不计为通过。 |

复跑方式（必须使用获授权的目录、可丢弃的独立 Redis；环境变量缺失时测试会跳过，跳过不能算验收）：

```sh
cd backend
export INFRANEXUS_LIVE_AD_URL='<authorized ldap/ldaps endpoint>'
export INFRANEXUS_LIVE_AD_BIND_USER='<bind UPN>'
export INFRANEXUS_LIVE_AD_DOMAIN='<AD domain>'
export INFRANEXUS_LIVE_AD_BASE_DN='<restricted test Base DN>'
export INFRANEXUS_LIVE_AD_REDIS_ADDR='127.0.0.1:<disposable Redis port>'
# 通过受控的秘密注入渠道设置 INFRANEXUS_LIVE_AD_PASSWORD，禁止硬编码或放进命令历史。
# Bind UPN 与登录账号不同时，另设 INFRANEXUS_LIVE_AD_LOGIN_USER。
go test -race -count=1 -timeout=180s -v ./internal/bootstrap -run '^TestLiveAD'
INFRANEXUS_TEST_REDIS_ADDR='<same disposable Redis address>' go test -race -count=3 ./internal/repository -run '^TestRedisEventStore'
```

R12 的真实后端冒烟验收已完成，R09/R13/R14 保留未完成，当前仍为 **Needs Fixes**。本次是明文 LDAP 389 到隔离应用的实际链路，未验证目标 Staging/网关、浏览器连接真实后端、真实 AD TLS/StartTLS/大目录跨页、部署数据异常盘点或人工读屏；不得据此勾选这些门禁。下方早先记录中的“未连接真实 LDAP”仅描述各节当时的验证范围。

## 2026-10-23 剩余本地整改与回归

本轮基于 `78083ff` 补齐本地缺口。R01–R08、R10、R11 达到本地验收；R09/R12/R13/R14 的目标网关、Staging 真链路、部署数据只读审计及人工读屏门禁继续保留，发布评级仍为 **Needs Fixes**。

环境：Go 1.27.2、Node 24.11.1、npm 11.6.2、系统 Chrome 155.0.8059.85；隔离 PostgreSQL 17.11 和 Redis 8.6.3，端口 55432/56379。Browser 插件未提供，Playwright 配套 Chromium 不存在，使用 `PW_CHROME_CHANNEL=chrome` 和现有系统 Chrome；沙箱内 Chrome 启动失败，浏览器回归经提升权限执行。未连接部署数据库或企业 LDAP/AD。

| 范围 | 实测证据与结果 |
| --- | --- |
| R02 授权刷新 | `TestAuthorizationWorkerAndRequestShareStableRefresh` 用读取/加载屏障交错 worker 与请求；`TestAuthorizationRejectsContinuouslyChangingSnapshotsAndRecovers` 验证连续变更失败关闭及稳定恢复。race 三轮通过。 |
| R05 JIT 负向路径 | `TestLDAPJITPropagatesDatabaseFailuresWithoutProvisioning` 覆盖 external/username/email/create 故障；邮箱冲突保持所有者不变、独立建档并忽略占用邮箱；停用身份不被重新启用。race 三轮通过。 |
| R06 Redis 生命周期 | 真实 Redis `CLIENT KILL TYPE pubsub` 后恢复收信；重复 10 次订阅/取消，每轮 `PUBSUB NUMSUB` 回到 0，且 `CLIENT LIST` 总连接数回到预热后的基线（不把退订当作连接释放）；空闲/满缓冲和跨实例用例三轮 race 通过。命令只针对一次性审计 Redis。 |
| R07 LDAP 网络与分页 | TLS/StartTLS/Search 阻塞取消后对端观察到连接关闭；已取消 ctx 不拨号；不可信证书默认拒绝。1001 用户跨三页完整返回；连续快速分页受总预算终止且不返回部分结果。预算测试通过私有共用实现注入 100ms，公开 SearchUsers 仍固定 10 分钟。`TestLDAPIncompleteSearchCannotPlanMissingUserDisables` 证明部分搜索+错误不读取本地档案、不生成缺失停用计划。race 三轮通过。 |
| R08 通知边界 | 旧实现正式回归失败：快照后滞后 finished 事件额外产生桌面通知（预期 2，实得 3）。修复普通事件 cursor 回退、非法 ID、旧连接迟到回调。finished 去重、裁剪快照、滞后事件，以及 Clock 暂停后的指数退避/次数上限/手动恢复/稳定复位通过。通知与跨窗口拖拽关键用例连续三轮 15/15 通过。 |
| R09 本地回收 | `TestSSECancellationReleasesBackpressuredSocketWriter` 在真实 TCP 连接的 net.Conn 写入边界注入阻塞，客户端停止读取，应用取消释放 writer 并正常 shutdown；`TestSSEEventStoreFailureClosesSocket` 验证存储读取失败终止流。三轮 race 通过。该故障注入不替代目标 TCP 黑洞/代理超时及资源计量演练。 |
| R10 用户编辑 | 双页面各自编辑邮箱/昵称，一方先成功；后台 snapshot refetch 不覆盖另一方草稿或 revision，409 明确确认后仅提交用户修改字段。保存失败保留浏览器后退拦截与 beforeunload 注册，成功后清理。新增两项 E2E 连续三轮通过；beforeunload 使用可取消原生事件验证注册，未模拟操作系统关闭窗口。 |
| R13 错误态对比度 | 强化错误态等待后，Axe 复现 QueryErrorState 描述与重试按钮的 serious color-contrast 违规；在业务组件改用正文色，保留错误边框/图标，未修改 UI 原子组件；实际错误态五个视口/主题用例通过，明暗主题无 serious/critical Axe 违规。 |
| R11 部门树 | 提取 memo 行并通过稳定 ref 分派事件；拖拽源移出虚拟窗口仍保持同一 DOM，边缘自动滚动、跨窗口投放、跨窗口 Home/End 焦点和 revision 校验回归连续三轮通过。生产构建性能矩阵 1k/10k 平级及 10k 混合树各三轮：启动 p95 964/987/1077ms，过滤 p95 21.8/17.5/26.3ms；树 DOM 1235–1270，虚拟行 31，最长任务 77ms。四视口、明暗及 reduced-motion 矩阵通过。浏览器版本与前轮不同，数据不作为严格同环境 A/B。 |
| 全量 Go | 最终冻结源码后，设置隔离 PostgreSQL/Redis 环境变量执行 `go test -race -count=1 -p=1 ./...` 通过；`go vet ./...` 通过。首次运行期间追加测试导入导致的编译失败已作废，未计为通过。 |
| 前端单测/构建 | Vitest 5 文件/17 项通过；`npm run build` 通过；入口 JS 523.76kB（166.87kB gzip），仍超过 500kB 建议值。 |
| 完整 E2E | 最终完整 E2E 33/33 通过（约 2.2 分钟），无跳过。原单用例视口/主题矩阵整体超过 30 秒，已拆为四个视口和一个深色主题用例，保留原有 pageerror、Axe、布局和焦点断言。截图复核后再加强为等待每页明确错误提示及可用重试按钮，避免仅测到骨架屏。保留一条角色权限对话框路径的 ResizeObserver 控制台告警；全套页面异常断言通过，该告警尚未定位消除。 |

复跑命令：

```sh
cd backend
# 环境变量必须指向可丢弃的独立审计服务，不能使用部署 Redis。
INFRANEXUS_TEST_POSTGRES_DSN='<isolated DSN>' INFRANEXUS_TEST_REDIS_ADDR='<isolated address>' go test -race -count=1 -p=1 ./...
go vet ./...
cd ../frontend
npm test
npm run build
PW_CHROME_CHANNEL=chrome npm run test:e2e
PW_CHROME_CHANNEL=chrome npm run test:perf
```

仍需环境验收：目标代理/TCP 黑洞与慢写上限计量、真实 LDAP/AD 登录到任务/SSE 全链路、部署策略与 LDAP 异常只读盘点、VoiceOver/NVDA 人工读屏。历史通过和本轮本地通过均不替代这些门禁。

## 2026-10-22 深度复审整改执行记录

本节记录当前整改变更的本地与隔离环境验证。代码基线为 `55de743`，所有命令均在包含本轮工作树差异的源码上执行。当前评级仍为 **Needs Fixes**：代码级门禁已大部通过，真实测试 LDAP、目标网关故障演练、部署数据只读核查及人工 VoiceOver/NVDA 检查尚未执行。

验证环境：Go 1.27.2、Node.js 24.11.1、npm 11.6.2、Playwright Chromium 156.0.8078.4；PostgreSQL 17.11 与 Redis 8.6.3 使用本地临时 Docker 服务（端口分别为 55432、56379），数据库名、口令和测试数据均为一次性审计值。未连接部署环境、生产数据库或真实 LDAP。

| 范围 | 本轮结果 |
| --- | --- |
| Go 全量 race | 最终工作树回归通过：`INFRANEXUS_TEST_POSTGRES_DSN=<isolated> INFRANEXUS_TEST_REDIS_ADDR=<isolated> go test -race -count=1 -p=1 ./...`；SQLite、真实 PostgreSQL、真实 Redis 测试均参与，无 race 报告。隔离数据库 Bootstrap 包耗时 145.099 秒。路由权限重试状态修正另以 `-race -count=5` 定向回归通过。 |
| Go 定向并发与取消 | 通过：授权并发撤权/重建、PG 策略事务、JIT 并发与身份冲突、LDAP 建档回滚、空闲/满缓冲 Redis 订阅取消、阻塞 Bind 取消、SSE 应用停机等目标测试以 `-race -count=3` 连续三轮通过；本轮另行补入认证/连接测试 30 秒总预算。 |
| Go 静态检查 | 通过：`go vet ./...`。 |
| 授权查询与锁开销 | PG 17，100 次：revision 读取均值约 156 µs、p50 137 µs、p95 249 µs。共享锁竞争基准以 12 个 GOMAXPROCS、4 倍并行度（最多 48 个并发写者）运行 100 次：吞吐口径 862 µs/op，单次获取延迟 p50 31.6 ms、p95 77.7 ms。后者是刻意制造的高并发单行锁排队场景，不代表常态请求延迟；尚未与生产负载或旧实现做同机 A/B。 |
| Vitest 与构建 | Vitest 5 个文件、17 个测试通过；`npm run build` 通过。入口 JS 523.54 kB（166.78 kB gzip），仍超过 Vite 500 kB 建议值。 |
| Playwright E2E | 24/24 通过，无跳过用例；含通知首断线 cursor、去重/身份切换、用户资料 409 保稿与焦点、并发状态操作、部门键盘/触屏菜单、响应式矩阵和 Axe。六模块 Axe 未发现违规。验证过程中保留一条 `ResizeObserver loop completed with undelivered notifications` 浏览器控制台告警；用例 `pageerror` 断言通过，建议在目标浏览器持续观察。 |
| 部门树性能 | `npm run test:perf` 通过；1k 平级、10k 平级和 10k 混合树各三轮。启动 p95 分别约 943 ms、946 ms、1,015 ms；20 次过滤 p95 分别约 19.5 ms、13.6 ms、16.5 ms；DOM 1,235–1,270 个，虚拟行 31 个，混合树最长任务 73 ms。均满足 2,000 ms / 100 ms / 10,000 / 200 ms 门槛。四种视口、明暗主题和 reduced-motion/no-preference 组合均执行。 |
| 动效与触屏 | 侧栏折叠改为单一 CSS keyframe 动画；reduced-motion 下动画和 transition 时长为 0，Base UI 双重动画告警已消失。新增 390 px 触屏菜单可见并可操作回归。 |

完整验证命令：

```sh
cd backend
INFRANEXUS_TEST_POSTGRES_DSN='<isolated PostgreSQL DSN>' \
INFRANEXUS_TEST_REDIS_ADDR='<isolated Redis address>' \
go test -race -count=1 -p=1 ./...
INFRANEXUS_TEST_POSTGRES_DSN='<isolated PostgreSQL DSN>' \
INFRANEXUS_TEST_REDIS_ADDR='<isolated Redis address>' \
go vet ./...

cd ../frontend
npm test
npm run build
PLAYWRIGHT_BROWSERS_PATH='<installed Playwright browser path>' npm run test:e2e
PLAYWRIGHT_BROWSERS_PATH='<installed Playwright browser path>' npm run test:perf
```

| 发布门禁 | 本地结果 | 上线前仍需补充 |
| --- | --- | --- |
| G1 授权 | 本地代码、SQLite/PostgreSQL 并发撤权、失败关闭、Outbox 回滚和 race 检查通过；PG 查询/锁竞争有本轮数据。 | 在目标多实例部署拓扑复核授权写入延迟与超时预算。 |
| G2 LDAP | 原子建档、缓存提交隔离、并发 JIT、错误身份拒绝和真实 TCP 阻塞 Bind 取消回归通过；认证/连接测试 30 秒、目录搜索 10 分钟总预算已实施。 | 真实 LDAP/AD 的 TLS、StartTLS、Search/分页取消与连续分页预算、正常大目录和不完整目录保护尚未在测试目录端到端验证。 |
| G3 实时链路 | Redis 空闲订阅取消、事件检查点、重连去重和真实 socket 应用停机回归通过。 | 客户端停止读取、TCP 黑洞、目标代理超时和实际停机资源回收尚未在目标网关演练。 |
| G4 交互与测试 | Go race/vet、Vitest、build、24 项 E2E 与 Axe 通过。 | 用户资料双表单并发、真实服务链路冒烟仍需 Staging 补充。 |
| G5 规模与体验 | 本地 1k/10k 性能预算通过；键盘、触屏、reduced-motion 自动检查通过。 | 实际租户目录形态与 VoiceOver/NVDA 人工读屏尚未覆盖。 |
| G6 环境与运维 | 本地隔离 PG/Redis 矩阵通过；API 文档已同步 revision 和 LDAP timeout 契约；本轮没有 schema 迁移。 | 部署数据只读策略/LDAP 异常盘点、真实目录、目标网关、备份恢复及生产回退开关仍需环境负责人执行。 |

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
