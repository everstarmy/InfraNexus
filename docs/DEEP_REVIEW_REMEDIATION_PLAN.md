# M0–M6 深度复审整改方案

日期：2026-10-22。当前发布评级：**Needs Fixes**。本文是深度复审后的增量实施契约；任务状态统一维护在 [TODOLIST](TODOLIST.md)。原 M0–M6 方案和验收记录保留为历史证据，不代表本文新增问题已解决。

## 1. 目标、范围与证据规则

目标是修复授权并发一致性、LDAP 建档/回滚、后台资源回收和前端状态边界，并建立可重复的发布门禁。本轮保留现有三层架构、Go/Fiber/Casbin 和 React/Base UI 技术栈；不做全站重设计，不自动部署、操作生产数据或重跑种子重置凭据。

实施遵循以下规则：

- Handler → Service → Repository；事务、数据库锁和底层错误识别放仓储，领域接口与错误放 domain。
- 每项先落一个能在旧实现上失败的有效回归，再修改实现；使用屏障、响应闸门、取消信号和注入故障，避免靠 sleep 撞竞态。
- Go race、数据库交错、浏览器 mock、真实网络验证分别记证据；任一层通过不能替代其他层。
- 审计中的代码片段只说明修复方向，实施时按实际接口、依赖源码及兼容约束完善，不直接机械粘贴。
- 临时审计探针应转成仓库内可维护的正式测试；`/tmp` 日志不能作为长期唯一验收资产。证据记录代码提交标识、环境、命令、断言、结果和未覆盖项。
- 不修改 `frontend/src/components/ui/` 生成原子组件；交互修复在业务组件、布局和 hook 层完成。

### 审计基线

既有后端五个核心包的 race 测试、Go vet、前端 17 项单测与生产构建通过。Chrome E2E 首轮 20/22：矩阵在增加总超时后单独通过，状态开关 pending 用例因成功分支未应用 mock 延迟失败。生产构建性能采样完成，但 10k 部门树约 7.68 秒渲染、200,614 DOM、最长 3,147ms long task，不能把用例执行成功解释为性能达标。

新增定向验证复现了五个后端问题：revision 数据竞争、LDAP 并发 JIT 唯一冲突、无部门建档残留用户、回滚部门缓存污染、空闲授权订阅不退出；两个前端探针复现重复通知和 connected 检查点未保存。授权重建覆盖并发撤权、SSE 慢写回收和 LDAP 总取消边界仍需补充真实环境证据。本次未重跑真实 PostgreSQL/Redis 基准，历史 M6 的环境数据不能冒充本轮结果。

## 2. 任务映射与实施顺序

严重级别来自审计；P0/P1/P2 是实施优先级，两者不混用。责任角色表示工作类型，尚未指定个人，也不表示启用多智能体并行实施。

| ID | 对应发现 | 严重级别 / 优先级 | 交付 | 前置依赖 | 责任角色 |
| --- | --- | --- | --- | --- | --- |
| R01 | H1 | High / P0 | 授权写事务统一锁序与快照保护 | 无 | 后端 |
| R02 | H3 | High / P0 | loadedRev 全路径同步访问 | 无 | 后端 |
| R03 | M2 | Medium / P0 | LDAP 用户与默认角色原子创建 | 无 | 后端 |
| R04 | H2 | High / P0 | LDAP resolver 按事务尝试隔离 | R03 | 后端 |
| R05 | M1 | Medium / P1 | JIT 唯一冲突安全恢复 | R03、R04 | 后端 |
| R06 | M3 | Medium / P1 | 空闲授权订阅取消与释放 | 无 | 后端 |
| R07 | M4 | Medium / P1 | LDAP 网络取消与总时限 | 无 | 后端 |
| R08 | M5 | Medium / P1 | SSE 初始检查点、去重与重连节制 | 无 | 前后端 |
| R09 | M6 | Medium / P1 | SSE 慢写上界与应用退出 | R08 | 后端 / 环境验收 |
| R10 | M7 | Medium / P1 | 用户完整编辑 CAS 与草稿基线 | 无 | 前后端 |
| R11 | M8 | Medium / P2，规模门禁 | 部门树虚拟化与性能预算 | R12 测试规范 | 前端 |
| R12 | M9 | Medium / P1 | 可信 pending、时钟与矩阵测试 | 无，优先实施测试基础 | 测试 / 前端 |
| R13 | 微调建议 | Low / P2 | 触控、焦点、动效和播报 | 相关业务修复 | 前端 |
| R14 | 发布收口 | 发布门禁 / P1 | 双引擎、真实链路与文档证据 | R01–R10、R12；大规模场景还需 R11 | 全栈 / 环境验收 |

执行分四阶段：先完成回归测试基础与 P0，再完成认证目录和实时链路 P1，随后性能/可访问性，最后统一发布验证。任务可独立提交，但依赖项未验收不得把下游标记完成。R11 在需要支持数千部门的发布范围内属于发布阻断项，不能以 P2 名义豁免。

## 3. 后端改造设计

### R01：授权写入统一串行化

范围：`backend/internal/repository/authorization_policy.go`、`role_repository.go`、`permission_repository.go`、`authorization_state_repository.go` 及对应测试。

在每个影响派生策略的事务第一步更新 authorization_state 单例行以获得写锁，然后读取角色/权限关联，再写关联、派生规则、revision 和 Outbox。锁顺序固定为「授权单例 → 角色/权限及关联 → Casbin 规则 → Outbox」。取得锁时不提前递增 revision；实际策略变更沿用事务内 revision/outbox 更新。行缺失必须报错并回滚。

逐一盘点状态修改、角色删除、权限分配、权限更新/删除、路由同步、单角色修复、全量重建和启动同步，禁止遗漏旁路；不要用进程内 mutex 替代跨实例锁。复用有界重试思想处理 SQLite busy 与 PostgreSQL 40001/40P01，并保证重试无事务外副作用。锁等待受 ctx/数据库超时约束。

验收：真实 PostgreSQL 和 SQLite 屏障测试覆盖「重建读取旧快照 ↔ 撤权」「权限 Path/Method 更新 ↔ 角色授权」「全量 ↔ 单角色同步」。最终派生规则与已提交关联一致；撤权不能被重建恢复；故障注入不留下半提交或虚假 revision。记录统一锁引入的等待与授权查询开销。

### R02：授权本地 revision 同步访问

范围：`backend/internal/service/authz_service.go`、授权 service 测试。

使用 `atomic.Int64` 保存 loadedRev，构造时 Store(-1)，快路径、锁内比较、成功发布和后台 worker 观察全部使用 Load/Store。保留 refreshMu 串行执行稳定快照加载；不能以原子字段替代现有 before/load/after 一致性校验。加载失败继续失败关闭。

验收：屏障启动多个首次刷新请求；再覆盖 worker 与请求刷新交错、连续 revision 变化、LoadPolicy 失败。race 检测无报告，不能把失败快照标为已加载。

### R03–R05：LDAP 原子建档、缓存提交与 JIT 恢复

范围：`backend/internal/service/ldap_service.go`、`ldap_sync.go`、`repository/user_repository.go`、domain 错误、相关 service/repository/API 测试。

1. **R03 原子创建**：复用现有 CreateWithRoles，将用户与初始角色放入同一仓储事务；有部门操作时加入组织 UoW。无部门策略也必须保证角色失败不残留用户，不额外制造无业务意义的组织 revision。
2. **R04 缓存提交**：resolver 的 cache/created 使用每次事务尝试的副本，只有外层提交成功后才合并；回调错误、提交失败和自动重试均丢弃尝试状态。整个任务累计统计只计算已提交部门；缓存命中已删除节点时应重新校验/失效，不能无条件复用旧 ID。
3. **R05 唯一冲突**：仓储按 SQLite/PostgreSQL 类型化错误识别具体身份唯一约束，并映射 domain 错误；不得解析任意错误字符串或把邮箱冲突一律视为同一身份。失败事务结束后才能读取获胜记录，避免 PostgreSQL aborted transaction 内继续查询。
4. **身份恢复契约**：只在 domain、稳定 ExternalID、认证类型一致且账号可用时接受获胜记录；没有稳定 ExternalID 的目录保持明确冲突，不自动绑定同名本地账号。普通数据库错误立即传播；唯一冲突恢复有界，不静默覆盖资料和角色。
5. **预查询错误**：provision 中只有 ErrRecordNotFound 表示不存在，其他查询错误不能吞掉后转为 Create 计划。错误响应和日志继续按现有领域码与脱敏规则处理。

验收：无部门/OU/属性三种策略，默认角色存在/已删除/分配写失败；第一条部门创建后回滚、下一条同部门仍成功；注入可重试错误后部门统计正确；两个及多个相同身份并发首次登录最终只有一个档案，所有合法请求获得同一身份。邮箱冲突、不同 ExternalID 同名、停用账号、数据库故障不能错误登录。

### R06：授权 Redis 订阅生命周期

范围：`backend/internal/repository/authorization_state_repository.go`、对应测试。

订阅成功后，通过显式 select 监听 ctx.Done，或用 context.AfterFunc 关闭 PubSub，从而唤醒空闲 Channel 接收。关闭输出 channel 与 PubSub 有明确单一所有者，取消回调在退出时解除；保留现有有界合并策略，不新增每消息 goroutine。

验收：零消息取消、满缓冲取消、Redis 中断、重新订阅、重复启停；输出 channel 关闭且真实 Redis 订阅连接回收。以 channel/连接完成信号为主要断言，goroutine 数量仅作辅助观察。此任务针对授权 PubSub，不把 SSE XREAD 错当 PubSub。

### R07：LDAP 从连接到分页的取消与预算

范围：`backend/internal/repository/ldap_directory.go`、directory Gateway 测试，必要时扩展 config/domain/配置文档。

connect 接收 ctx；TCP 使用 DialContext，LDAPS 握手使用 HandshakeContext；连接建立后用取消回调关闭连接，覆盖 StartTLS、Bind、Search 和分页。保留单操作超时，再设置整个认证/连接测试/目录搜索的总预算。批量搜索预算应独立于单操作超时，避免直接用默认 10 秒截断合法大目录。取消错误保留 errors.Is 语义，不能全部转换成凭据错误；不得引入无法终止的外包 goroutine。

验收：已取消 ctx 不拨号；拨号、TLS、Bind、Search 阻塞可取消；每页及时返回但总时限超出的服务被终止；正常分页不截断、不误触发缺失用户停用。搜索失败/不完整必须禁止按完整目录执行 disable-missing。保留 TLS 证书与密码脱敏测试。

### R09：SSE 慢写与停机资源上界

范围：`backend/internal/handler/sse_handler.go`、`bootstrap/fiber.go`、应用生命周期装配与真实 socket 测试。

先核对当前 Fiber/fasthttp StreamWriter 的管道与 socket deadline 行为，再实现可验证的写入期限和连接最大寿命。若采用全局 WriteTimeout 作为第一阶段方案，明确它约束整个响应、会周期断开正常 SSE，并评估普通长请求；不能声称它是滑动空闲超时。最终需保证应用停机也能终止被阻塞写入，单纯取消 Redis Read 不足以实现这一点。

流循环持有独立应用生命周期 ctx 的子 context，不在异步回调中保留/访问复用的 fiber.Ctx。每次读取有界，写入失败和取消关闭时不触发额外重连风暴。计划性换连接必须保留 cursor，因此依赖 R08。

验收：真实 HTTP 连接正常关闭、客户端停止读取、TCP 黑洞/代理中断、Redis 故障和应用停机；记录回收时间、连接数、goroutine 和 Redis 阻塞读取。响应体关闭等已感知断开立即取消待处理 Read；TCP FIN 转为可感知写错误可能需要两次心跳，本地 Docker/Nginx 以 25 秒预算实测（不能把首次 FIN 当作生产者已收到取消）。黑洞以配置的写入/连接上限验收。停机按服务总 shutdown 预算验收，不用无 deadline 的等待。

## 4. 前端与跨端契约

### R08：SSE 检查点、去重和重连

范围：`backend/internal/handler/sse_handler.go`、`frontend/src/stores/notifications.tsx`、SSE handler/store 测试与 `frontend/e2e/notifications-reconnect.spec.ts`。

- connected 携带当前已解析的 lastID，前端在任何业务事件前保存检查点；不能取一个更新的 LatestID 覆盖客户端原有 cursor，否则会跳过待补事件。
- 按 Redis Stream ID 维护有界去重记录；重复事件不得重复 Toast、桌面通知、声音或任务状态副作用。先校验/解析载荷，再按契约处理 cursor；snapshot.required 必须能跨过保留缺口。
- 检查点与去重集绑定当前身份代际，旧连接迟到事件不修改新账号状态；通知列表继续保持 30 条。若持久化 cursor，按用户及 schema 隔离并定义刷新后的快照恢复，不保存敏感通知正文；不能只持久化 cursor 却跳过必要快照。
- connected 不立即清零退避计数；达到稳定在线窗口后再清零。保留抖动和最大退避；持续失败进入可见 offline/冷却，提供手动重试，避免达到次数后永久失联。401/403、auth.expired 与网络失败分开处理。
- 不承诺 Redis Stream 超过保留窗口仍能逐条恢复；通过快照接口校准最终状态。

验收：首次连接后零业务事件断线、连续多次重连、重复 started/finished、事件滞后/裁剪、连接成功后立即读失败、认证过期、账号切换、卸载和刷新恢复。用 Clock 验证退避递增、稳定复位、冷却与取消，不依赖随机等待。

### R10：用户完整编辑 CAS

范围：`frontend/src/pages/users/components/user-form-dialog.tsx`、`services/users.ts`、`backend/internal/domain/user.go`、`service/user_service.go`、API 与表单测试、`docs/API.md`。

表单初始化时固定资料和 edit_revision 基线；后台刷新不能覆盖草稿或静默提升提交 revision。请求携带基线，后端 CAS 更新，409 保留草稿、读取最新资料并要求明确比较/确认。表单无变更不提交，保存中防重复；成功关闭后清理 dirty，失败保持保护。

目标契约为用户资料更新必须提供有效 expected_revision。实施前盘点仓库内与外部 API/CLI 调用方；先更新调用方，再在明确的不兼容发布窗口收紧服务端校验，同步 API 文档。若必须保留旧客户端兼容，则单独记录调用方、期限与风险，不能把无条件写路径标记为并发安全或 R10 全部完成。不改变部门接口的 organization revision 语义。

验收：A 编辑邮箱期间 B 更新昵称、双表单提交、缺失/零/旧 revision、409 后取消/保留草稿确认、后台 refetch、保存失败导航保护、成功后不再误拦截。

### R11：部门树虚拟化与预算

范围：`frontend/src/components/common/department-tree.tsx`、树工具、业务树容器、`frontend/perf/m6-baseline.spec.ts` 及交互 E2E。

仅将展开后的可见节点扁平化为 `{node, depth, parentId, position, siblingCount}`，用稳定 ID 虚拟渲染；行 memo 化，预计算索引，避免 dragover 重复全树查找。现有原生拖拽、搜索高亮、下一处匹配、选中展开、键盘和触屏菜单替代必须保留。焦点进入未挂载节点时先滚动再聚焦；补充 aria-level/posinset/setsize，不能用可视窗口位置冒充树节点位置。

实现前评估已有依赖；如新增虚拟列表库，记录选型并同步 package-lock，不升级无关依赖。初始候选门槛：固定基准环境、至少 3 轮 10k 样本，可操作时间 p95 ≤2 秒、输入过滤 p95 <100ms、DOM 总元素 ≤10,000、单次主线程任务 ≤200ms。门槛需在实现前按固定 runner 校准并写入断言；调整需说明原因，不能测后静默放宽。保留原基线用于对比。

验收：1k/10k 平级树和深度≤15 的混合树、长标签、快速滚动搜索、拖动跨窗口、键盘 Home/End/左右键、移动端菜单操作、320–2560px、明暗与 reduced-motion。普通 100 行用户表不强制虚拟化。

### R12–R13：测试可信度与体验微调

R12 先修成功请求 pending mock：用显式响应闸门，先验证 disabled 和请求数，再放行并验证恢复与撤销 revision；失败分支用独立闸门验证行隔离。闸门须有 finally/清理路径，防止测试失败后挂住服务。矩阵按模块/主题拆分或显式合理总预算，保留 pageerror/Axe/布局断言，不能仅靠提高超时掩盖性能失败。认证过期后不重连使用 Clock；真实端到端另建冒烟层，不替换现有可控 mock 用例。

R13 在业务组件中完成：触控设备常显昵称编辑和树操作入口、扩大命中区；Cmd+K 避让 alertdialog 和 defaultPrevented，校验遮罩及焦点恢复；冲突/保存失败聚焦错误摘要，进度 aria-live 节流；侧栏 Collapsible 仅保留一种动画机制，尊重 reduced-motion。人工 VoiceOver/NVDA 验收独立记录。

## 5. 兼容、配置与数据修复

本轮默认不改表结构、不重写已应用 migration、不清空 Casbin/Outbox 或重置种子。若实现确认需要新字段/索引，新增版本化迁移，并验证 SQLite/PostgreSQL 新库、存量库、重复运行及失败回滚；不得删除既有唯一约束来掩盖 JIT 冲突。

新增 LDAP 总预算、SSE 寿命/写入预算或重连冷却配置时，必须同时覆盖默认值、范围校验、开发/生产说明和测试；名称与最终配置结构在实施中确认，不在本文虚构已存在的配置键。SSE connected 增加 ID 属增量契约，仍要验证旧前端与新后端组合；资料 revision 必填属于行为收紧，按 R10 的发布窗口处理。

修复代码不会自动纠正历史异常。上线前提供只读核查：派生策略与角色关联差异、LDAP 无默认角色档案、异常部门引用与任务计数；报告候选记录。只有明确身份和业务意图后才定向修复，不能自动给所有缺角色用户补权。策略重建只在 R01 保护已生效后执行，并记录差异与结果。

## 6. 发布门禁与执行证据（R14）

| 门禁 | 必须满足的断言 |
| --- | --- |
| G1 授权 | R01/R02 完成；双引擎并发重建不能恢复撤权；多个实例收敛；加载/数据库错误失败关闭；race 无报告 |
| G2 LDAP | R03/R04/R05/R07 完成；建档无半提交、缓存无回滚污染、同身份并发安全、取消可终止，不完整目录不执行缺失停用 |
| G3 实时链路 | R06/R08/R09 完成；空闲订阅释放；首断线不丢检查点；重复事件无重复副作用；慢写和停机有界 |
| G4 交互与测试 | R10/R12 完成；CAS 与 dirty 生命周期正确；稳定 pending 测试；完整 E2E/Axe/四视口回归；不能跳过失败用例宣称全绿 |
| G5 规模与体验 | 数千部门场景须完成 R11；性能预算落地并通过；R13 人工/自动结果分别记录 |
| G6 环境与运维 | 独立 PG/Redis、真实 LDAP 测试目录、目标网关断线/超时、升级兼容与只读异常核查完成；未运行项明确阻断或限制适用范围 |

每个任务交付代码、正式回归、接口/配置说明（适用）与完成证据。以下为后续执行命令模板，不代表本次方案编写已运行：

```sh
cd backend
go test -race -count=1 ./internal/service ./internal/repository ./internal/handler ./internal/bootstrap ./internal/middleware
go vet ./...
# 全量发布验证另在隔离 PostgreSQL/Redis 环境提供测试环境变量：
# INFRANEXUS_TEST_POSTGRES_DSN / INFRANEXUS_TEST_REDIS_ADDR
go test -race -count=1 -p=1 ./...
```

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:e2e
npm --prefix frontend run test:perf
```

隔离服务必须可丢弃，环境缺失产生的 Skip 不能算通过。前端 mock 层通过后，另执行真实后端的登录→授权/撤权→LDAP 测试目录任务→SSE 重连冒烟；不要在日志或报告中保存凭据。

发布顺序：先在隔离环境验证全链路，再进入 Staging；有行为收紧时按兼容窗口部署调用方与后端。出现撤权失效、身份误绑定、数据半提交或资源持续增长时停止开放相应写入口；数据库采用备份与前向修复流程，不能默认回退旧二进制即可恢复安全。最终结论写入新一轮验证记录并更新 TODOLIST，满足适用门禁后才可改为 Ready for Release。
