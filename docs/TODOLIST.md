# InfraNexus 工程交付与实施待办清单 (TODOLIST.md)

本清单用于追踪 **InfraNexus** 的工程交付。当前执行任务为下方「M0–M6 深度复审整改」；原 M0–M6 看板保留供追溯，不作为本轮验收结论。

## 2026-10-22 当前看板：M0–M6 深度复审整改

实施契约、任务依赖、兼容策略与发布门禁见 [深度复审整改方案](DEEP_REVIEW_REMEDIATION_PLAN.md)。当前评级 **Needs Fixes**：2026-10-23 已补齐 R02/R05/R06/R07/R08/R10/R11 的本地代码与专项验收；R01–R08、R10、R11 本地验收完成。已补真实 AD 与隔离应用 HTTP/SSE 链路验收，并修复真实 Redis 阻塞读取取消后延迟停机的问题；R12 的真实后端冒烟已补齐；R09/R13/R14 仍有目标环境或人工门禁。逐项证据见下表和 [本轮发布验证记录](RELEASE_VALIDATION.md)。

完成规则：每项需补变更/提交、正式回归名称、实际命令与结果、环境和未覆盖项。`[x]` 只表示达到本轮验收；环境缺失导致 Skip、只通过 mock 或仅完成代码，不可自动勾选。责任角色见方案，不预设人员或并行代理。

### A：P0 授权与事务修复

- [x] **R01 / H1 / High：授权写入统一串行化**
  - [x] SQLite/PostgreSQL 并发重建与撤权回归使用同步起跑屏障，并断言最终关联和派生策略都已撤销。
  - [x] 角色状态/删除/授权、权限更新/删除、路由同步、单角色修复和全量重建均先锁授权状态单例。
  - [x] 缺少单例行时失败；事务锁序固定；SQLite/PostgreSQL 锁错误有界重试并尊重 context；关联、策略、revision 和 Outbox 同事务回滚。
  - [x] 可重试回调每轮重置事务外返回状态，避免失败尝试污染最终结果；路由权限并发幂等 race 回归连续 5 轮通过。
  - [x] SQLite/PostgreSQL 并发与故障回滚通过；补 PG revision 查询与 48 并行写者锁等待基准，数据见 RELEASE_VALIDATION。
- [x] **R02 / H3 / High：loadedRev 全路径同步访问**
  - [x] 转为 atomic.Int64，初始化、快路径、锁内比较、成功发布及 worker 读取均使用原子访问。
  - [x] 保留刷新互斥与稳定快照校验；加载失败不推进 loadedRev，失败关闭。
  - [x] 并发首次刷新、worker/请求刷新交错、连续 revision 变化和加载失败均有正式回归；不稳定快照失败关闭，稳定后恢复。
- [x] **R03 / M2 / Medium：LDAP 原子建档**
  - [x] 复用 CreateWithRoles；无部门路径用户与默认角色同事务，有部门时用户、角色、部门与组织 revision 纳入组织 UoW。
  - [x] 缺失默认角色时用户回滚；成功后确认角色/部门存在且组织 revision 只推进一次，无部门创建不制造组织 revision。
- [x] **R04 / H2 / High：resolver 缓存与统计提交隔离**（依赖 R03）
  - [x] 每次事务尝试复制 cache/created；外层提交成功后才合并，失败或重试丢弃尝试状态。
  - [x] 缓存命中会复核部门是否仍存在，删除缓存后重新查找；统计只保留已提交部门。
  - [x] 回滚后同部门重试、已删除部门缓存失效及最终统计均有正式回归。

### B：P1 身份、生命周期与实时一致性

- [x] **R05 / M1 / Medium：并发 JIT 唯一冲突恢复**（依赖 R03、R04）
  - [x] SQLite/PostgreSQL 身份唯一冲突映射为 domain 错误；邮箱等其他唯一约束不会误判为同一目录身份。
  - [x] 唯一冲突事务结束后再读获胜身份；校验 domain/ExternalID/auth_type/status；没有稳定 ExternalID 时拒绝同名自动绑定。
  - [x] provision 仅把 ErrRecordNotFound 当作可创建，其他预查询错误直接返回。
  - [x] 同身份并发、同名本地账号、邮箱占用、停用档案与各阶段数据库故障回归通过；邮箱占用按契约忽略邮箱并独立建档，不绑定或修改邮箱所有者。
- [x] **R06 / M3 / Medium：空闲授权 PubSub 释放**
  - [x] 空闲接收在 ctx 取消时主动关闭 PubSub 并唤醒消费者；输出 channel 单一所有者关闭，有界合并保留。
  - [x] 真实 Redis 跨实例发布、零消息/满缓冲取消、CLIENT KILL 后重订阅及 10 次启停通过；每次取消后的 PUBSUB NUMSUB 回到 0，CLIENT LIST 总连接数回到预热基线；race 连续三轮通过。
- [x] **R07 / M4 / Medium：LDAP 网络取消及总时限**
  - [x] 使用 DialContext、HandshakeContext 和连接取消关闭覆盖 TLS/StartTLS/Bind/Search/分页调用链；保留 context 错误语义。
  - [x] 单操作 timeout 范围与默认值同步 API 文档；Authenticate/Test 有 30 秒总预算，SearchUsers 有独立固定 10 分钟总预算。
  - [x] TCP 上 Bind/TLS/StartTLS/Search 阻塞可取消；已取消 ctx 不拨号；默认拒绝不可信证书。1001 用户跨页完整性、快速连续分页总预算耗尽和部分搜索禁止缺失停用回归通过；真实企业目录列入 R14。
- [x] **R08 / M5 / Medium：SSE 检查点、去重与退避**
  - [x] connected 事件返回服务端当前已解析 cursor，前端立即保存；2,048 项有界去重在业务副作用之前生效，通知列表限 30 条。
  - [x] 连续失败使用抖动退避、最大次数与手动重试；稳定在线 30 秒后才重置退避，认证过期停止，身份代际隔离迟到事件。
  - [x] cursor 只保存在当前用户连接生命周期内，不跨刷新持久化敏感正文；snapshot.required 触发数据重新校准。
  - [x] 首断线、重复 started/finished、保留缺口快照、滞后事件、账号切换、过期、退避上限/手动重试/稳定窗口复位均有 Clock 断言；修复滞后事件回退 cursor 和旧连接迟到回调。
- [ ] **R09 / M6 / Medium：SSE 慢写与停机上界**（依赖 R08）
  - [x] 使用 Fiber/fasthttp per-route 2 分钟连接寿命、默认 WriteTimeout 和应用 shutdown 取消；真实 TCP socket 测试确认停机关闭连接。
  - [x] SSE 流循环使用应用生命周期 context，异步 writer 不持有 fiber.Ctx；有界 Redis Read 周期和连接轮换保留 cursor。
  - [x] 真实 AD + Redis 应用冒烟复现 XREAD 不随 context 取消退出；阻塞读取改用独立单连接池并随取消关闭。正式回归三轮、每轮 5 次取消均在 1 秒内退出，连接数回到基线，共享客户端可用；应用在 3 秒 shutdown 预算内退出。
  - [ ] 真实 socket 停机、客户端停止读取并在 net.Conn 注入写阻塞、事件存储失败退出已通过；目标 TCP 黑洞、真实代理超时及目标拓扑连接/协程回收计量仍待环境演练。
- [x] **R10 / M7 / Medium：完整用户编辑 CAS**
  - [x] 表单固定 edit_revision 基线；后台刷新不覆盖草稿或静默提升版本。
  - [x] 409 保留草稿并显示两侧差异，用户明确确认后才用最新 revision 重试；失败摘要聚焦，成功关闭，保存中禁止重复。
  - [x] 仓库内 Web 调用方已同步必填 revision，后端拒绝缺失/零 revision，API 文档说明外部客户端升级要求。
  - [x] 缺失/零/旧 revision、双表单交叉字段修改、后台 refetch、409 保稿/确认、保存失败后浏览器后退拦截与 beforeunload 保护、成功清理均有正式回归；双表单/导航用例连续三轮通过。
- [x] **R12 / M9 / Medium：可信交互回归基础**（先于依赖它的业务验收）
  - [x] 用户状态更新使用独立响应闸门和 finally 清理，断言 pending、防重、行隔离及撤销时递增 revision。
  - [x] 通知退避与身份过期用 Playwright Clock；响应式矩阵保留 pageerror、Axe 和布局断言。
  - [x] 并发/回滚/取消后端探针和通知、用户 CAS 前端探针均纳入仓库正式测试。
  - [x] 关键通知/状态/CAS E2E 连续三轮通过；完整 E2E 33/33 无跳过。真实 AD + 临时 SQLite/Redis + 真实 HTTP/SSE 冒烟验证并发 JIT、撤权、同步幂等与重连补发。

### C：P2 性能与体验

- [x] **R11 / M8 / Medium：部门树虚拟化与性能门禁**（依赖 R12 本地测试规范；数千部门发布必须完成）
  - [x] 可见节点扁平化、稳定 ID 虚拟列表、预计算索引和行 memo 已完成；拖拽时固定源 DOM，支持边缘自动滚动与跨虚拟窗口投放；未新增依赖。
  - [x] 搜索定位、高亮、键盘树语义、触屏节点菜单及 ARIA 树层级/位置语义已保留；拖拽跨节点回归通过。
  - [x] 固定本机 runner 并把候选门槛写入断言：10k 启动 p95≤2s、输入 p95<100ms、DOM<10,000、最长任务≤200ms。
  - [x] 1k/10k 平级/混合树各三轮、深度≤15、四视口、明暗和 reduced-motion 矩阵通过；结果见 RELEASE_VALIDATION。
- [ ] **R13 / Low：触控、焦点与动效微调**
  - [x] 无 hover 设备常显编辑/菜单入口并扩大触控命中区；Cmd+K 避让 alertdialog 与 defaultPrevented。
  - [x] 冲突/保存错误摘要自动聚焦；进度播报节流；侧栏折叠统一为单一 keyframe 动画并支持 reduced-motion；修复业务查询错误态描述/重试按钮的文字对比度。
  - [ ] 键盘、触屏、焦点恢复、reduced-motion 已有自动回归；VoiceOver/NVDA 人工记录仍待完成。

### D：发布收口

- [ ] **R14：回归、兼容与发布证据**（依赖适用 R01–R13）
  - [x] 隔离 PostgreSQL、SQLite、真实 Redis 的并发、回滚、取消和跨实例矩阵通过；环境变量已设置，目标用例未被 Skip。
  - [x] 全量 Go race/vet、Vitest、build、E2E、性能门禁通过；环境、命令、结果和限制已写入 RELEASE_VALIDATION。
  - [x] 用户授权的真实 AD 只读绑定/认证/搜索通过；隔离应用验证 3 并发 JIT→1 档案、即时撤权、预览不写、重复任务幂等、全量后增量预览及 Redis SSE 补发，race 通过。
  - [ ] 目标网关上的真实链路、黑洞与停机演练；LDAPS/StartTLS 和大目录跨页尚未在真实 AD 验收。
  - [ ] 只读核查部署数据中的历史策略差异、LDAP 缺角色/部门异常与计数，形成定向修复清单，不自动补权。
  - [x] API 文档同步 revision 与 LDAP timeout 契约；本轮未改 schema，无需新增迁移。
  - [x] 本轮 RELEASE_VALIDATION 已更新，包含 2026-10-23 补齐证据与限制。
  - [ ] 真实环境、R09/R13 等适用门禁补齐后再改为 Ready for Release。

本轮完成证据登记（首轮基于 `55de743`，2026-10-23 补齐基于 `78083ff`；每项状态只表示下述范围与证据）：

| 任务 ID | 变更/提交 | 回归、环境及实际结果 | 限制/兼容影响 | 状态 |
| --- | --- | --- | --- | --- |
| R01 | `authorization_policy.go`、角色/权限仓储 | SQLite + PG17 并发撤权/重建、Outbox 回滚；revision 与 48 并发 writer 基准。 | 串行锁竞争基准是本机合成负载，需在 Staging 校验预算。 | 本地验收完成 |
| R02 | `authz_refresh_test.go`、`authz_service.go` | 并发首次刷新、worker/request 屏障交错、连续版本变化失败关闭及稳定恢复；race 三轮。 | 稳定快照校验保留。 | 本地验收完成 |
| R03 | `ldap_service.go`、`user_repository.go` | CreateWithRoles；角色缺失回滚、用户/角色/部门原子成功、组织 revision 断言。 | 真实 AD + 隔离 SQLite 冒烟已补；目标拓扑另验。 | 本地验收完成 |
| R04 | `ldap_service.go`、`ldap_sync.go` | resolver 每次尝试克隆，提交成功后合并；缓存部门删除失效和统计正式回归。 | PG 真实 LDAP 任务链路待 Staging。 | 本地验收完成 |
| R05 | `ldap_jit_negative_test.go`、身份仓储/Service | 同身份并发、邮箱所有者保护、停用身份、预查询/创建故障传播；race 三轮。 | 被占用邮箱按现有契约忽略，不自动绑定所有者。 | 本地验收完成 |
| R06 | 授权 Redis 仓储与测试 | Redis 8 CLIENT KILL 恢复、10 次启停、NUMSUB 归零且总连接数回到基线、空闲/满缓冲取消；race 三轮。 | 仅使用隔离 Redis，未操作部署 Redis。 | 本地验收完成 |
| R07 | `ldap_cancel_test.go`、`ldap_paging_test.go`、`ldap_incomplete_search_test.go` | TCP 网络阶段取消、证书默认校验、1001 用户分页、快速分页总预算及不完整搜索保护；race 三轮。 | 预算测试复用生产实现并注入短预算；真实企业 LDAP/AD 仍属 R14。 | 本地验收完成 |
| R08 | 通知 Store、SSE 和重连 E2E | finished 去重、裁剪快照/滞后事件、最大退避与手动恢复、稳定窗口复位；专项 E2E 三轮。 | 普通事件 cursor 单调前进，快照可显式重置；仅当前身份内存保存。 | 本地验收完成 |
| R09 | SSE 生命周期、`sse_backpressure_test.go` | socket 停机、注入 net.Conn 写阻塞后取消回收、事件存储失败关闭；race 三轮。 | 真实 Redis XREAD 取消/连接回收已补；仍需目标 TCP 黑洞、代理和规模计量。 | 环境待验 |
| R10 | 用户 CAS 与两份用户编辑 E2E | 双页面交叉字段更新、refetch 不覆盖草稿、冲突确认、失败后退拦截、beforeunload 注册及成功清理；三轮。 | 外部调用方仍须按 API 文档提供 revision。 | 本地验收完成 |
| R11 | 部门树 memo/虚拟化与性能 E2E | 源 DOM 固定、边缘滚动、跨虚拟窗口投放；1k/10k 平级/混合树各三轮及视口/主题矩阵通过。 | R12 的本地测试基础已验收；Staging 真链路另列 R14。 | 本地验收完成 |
| R12 | E2E 通知/状态/CAS 与后端正式测试 | 关键回归连续三轮通过；完整 Go race/vet、Vitest 和 33/33 E2E 通过，无跳过。 | 实际 HTTP 客户端连接真实后端与 AD；浏览器 E2E 仍使用 mock，目标拓扑列入 R14。 | 验收完成 |
| R13 | 部门树、用户表单、侧栏、通知播报 | 触屏、键盘、焦点/reduced-motion 自动检查通过；真实错误态等待后修复文字对比度，Axe 六模块明暗主题无 serious/critical 违规。 | VoiceOver/NVDA 人工读屏待验。 | 部分完成 |
| R14 | 本文与 `RELEASE_VALIDATION.md` | 全量本地隔离矩阵、33/33 E2E 与性能预算完成；API 兼容契约记录；当前评级保留 Needs Fixes。 | 真实 AD 基础链路已补；目标网关/部署数据审计、目录 TLS/规模和人工读屏仍待验。 | 环境阻断 |

---

## 历史看板：2026-10-22 问题修复与前端交互改造（M0–M6）

> 看板整理（2026-10-22）：按用户要求，以下历史章节的待办统一勾选归档；深度复审整改的完成状态以顶部当前看板为准。历史勾选仅表示归档状态，实际验收范围与限制以原始证据为准。

历史实施契约、文件范围、接口/迁移和验收矩阵见 [问题处理与前端交互改造方案](REMEDIATION_AND_UX_PLAN.md)。下方保留当时的任务勾选和结果，不代表顶部 R01–R14 已完成；与最新就绪度冲突时，以深度复审整改看板为准。

状态规则：`[ ]` 表示该交付项尚未达到验收；`[x]` 必须附完成证据。下面的执行状态登记记录本轮已落地的部分改动，即使所属大项仍因缺少并发、数据库或浏览器验收保持未完成。证据至少包括变更、验证命令与结果、限制。

### 本轮执行状态登记（2026-10-22）

本轮按风险顺序完成 M0–M5 改造，并于 M6 完成代码级与隔离环境发布验证。真实 LDAP、生产网关和人工读屏仍列为上线前环境验收，不用本地模拟冒充已完成。

| 任务 | 本轮落地 | 当前状态与未覆盖验收 |
| --- | --- | --- |
| S01 | 用户资料接口拒绝状态/角色/部门字段；新建初始角色与部门要求额外 API 能力，新增独立调岗端点；管理员授予、非管理员授权范围、权限 Path/Method 改写与关联 ID 均有边界检查。 | M0 代码和关键负向用例完成；仍未穷举所有低权限组合。 |
| S02 | 移除默认管理员口令；新增显式 `bootstrap-admin` 与 `rotate-admin-password` 命令；口令强度、生产 JWT/目录密钥校验；重启不重置凭据。 | M0 通过 SQLite 与临时 PostgreSQL 17 的旧版表结构升级演练，检查旧口令保留、显式轮换、auth_version 递增与敏感日志；未触碰部署数据库。 |
| S03 | Session、Access/Refresh 都校验 auth_version；停用/改密原子递增，重新启用不回退，LDAP 禁用沿用递增逻辑；状态切换使用 edit_revision CAS，保留旧客户端省略 revision 的兼容路径。 | M1 定向验收通过：禁用再启用后旧 Cookie/Access/Refresh 均拒绝，新凭据可用；旧 revision 冲突、LDAP 禁用递增、并发 refresh 单成功均有回归。 |
| S04 | SSE 订阅入口按权限拦截；Session/版本/过期周期复核；Redis Stream 跨实例事件、Last-Event-ID 与快照恢复；账号切换关闭旧连接并隔离迟到事件。 | M0 + M2 完成；会话撤销/到期、Redis 保留缺口、重连与账号切换均有定向验证，详见 M2 验收证据。 |
| U01-A / U03 | 授权树/角色详情加载失败时禁用保存；草稿只从成功详情初始化；授权提交带 `edit_revision`，冲突后保留草稿并要求比较/确认。 | M0 浏览器验收通过：403/500/断网、角色切换，以及模拟另一管理员更新后的 revision 冲突、比较/确认和提交。 |
| V01 | 迁移注册表按版本执行并在同一事务写 ledger；M0 的安全/状态迁移保持原版本标识，M1 新增 LDAP task request_id 迁移；补充生产备份、混合版本与前向修复步骤。 | M1 定向验收通过：SQLite 重复启动不重跑回填，旧 SQLite/临时 PostgreSQL 17 存量结构升级通过；运维步骤见 [MIGRATION_OPERATIONS.md](MIGRATION_OPERATIONS.md)。 |
| S07 | request_id 贯通访问/错误/GORM 日志和 LDAP 后台任务；错误分类无响应副作用；认证会话删除、同步锁释放、SSE 写入与资源关闭失败可观察，偏好部分失败返回 503 和部分成功数据。 | M1 定向回归通过：响应与访问日志的 409/request_id 对齐；偏好部分失败的 503/body/request_id 明确；LDAP 任务记录 task/operator/request ID；GORM 参数化查询关闭敏感 SQL 参数。 |
| D01 / D02 / D03 | 可清空资料、单人调岗、角色分页查询、用户+初始角色事务与关联 ID 校验落地；登录时间不再错误推进资料 edit_revision。 | M1 定向验收通过：缺失/空值/null/UUID、150 条角色分页与百条后搜索、末页删除、刷新失败保留数据、重复角色 ID、关联失败无残留均覆盖。 |
| U01 / U02 | 六个业务页与详情浮层区分加载/占位/错误/403/空数据；Data Router 页面路由按唯一叶子权限注册；草稿集中注册单一路由 blocker，并保护浮层关闭与 beforeunload。 | M3 定向验收通过：Dashboard 500 后手动恢复、角色树 403/500/断网、权限草稿 Esc/遮罩/后退、焦点恢复及 beforeunload 事件均验证；侧栏/命令复用同一 Router blocker，未单独重复浏览器用例。 |
| U04 | 用户与角色状态切换按实体乐观更新；局部快照回滚、返回值合并、统计/列表失效与 revision 保护；撤销发起新的授权请求。 | M1 浏览器验收通过：A 行失败不回滚 B 行成功；同一用户操作期间开关禁用，撤销用更新后的 revision 重新提交。 |
| S05 / S06 / S08 | 部门结构与调岗统一事务协议；Casbin 关联/派生策略/授权 revision/outbox 原子提交；多实例 revision 收敛；显式 API 路由分类与漂移报告。 | M2 完成；SQLite 与临时 PostgreSQL 17 并发屏障、双实例撤权、注入写故障回滚、路由漂移/并发同步均通过，详见 M2 验收证据。 |
| U03 / U05 / U06 / U08 / U09 | 权限配置、可访问性基础与高频管理交互。 | U03/U05/U06/U08/U09 定向浏览器验收通过；读屏仍需人工抽查。虚拟化仍受 P3 性能门槛约束。 |
| U07 | LDAP 检查→持久化预览→Diff 确认→幂等执行→可恢复任务结果；计划版本校验、逐用户 CAS、lease fencing、进度快照与受控诊断明细。 | M5 定向验收通过：配置/目录/本地版本变化和过期计划均要求重审；重复请求复用任务；部分失败、越权明细、过期 lease 恢复与旧 LDAP 日志 SQLite 升级均覆盖；Playwright 验证预览确认及刷新恢复 3/10 快照。旧 PostgreSQL 结构升级已在 M6 隔离实例演练；真实 LDAP 部署验证仍需 Staging。 |
| V02 / V03 / V04 | 全量 Go race/vet、临时 PG17/Redis8 并发/迁移/实时矩阵，Playwright+Axe 六模块四视口与性能采样，发布/API/迁移文档同步。 | M6 软件与隔离环境矩阵完成；M3 人工 VoiceOver/NVDA、真实 LDAP 和目标网关回退开关需由 Staging/生产环境负责人验收，详见 [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md)。10k 部门树基线触发虚拟化建议，当前未实现虚拟化。 |

**本轮验证证据**：M0–M5 的阶段证据保留在各阶段条目。M6 执行全量 Go `-race`（隔离 PG17/Redis8、134 个测试/子测试通过，无 race 报告）和 `go vet`；Vitest 5 文件/17 测试通过；Playwright 22/22 通过，六模块四档视口无横向溢出，浅/深主题 Axe serious/critical 为零。生产构建通过，入口 chunk 为 522.54 kB（166.49 kB gzip）。性能基线包含用户表 100 行、1k/10k 部门树、500 条 LDAP 预览，以及 PG 授权 revision / LDAP lease 快照与 Redis SSE 发布读取；10k 树渲染 7.54 秒、最长主线程任务 2.89 秒，决定将大规模树虚拟化作为明确后续。临时 PG custom dump 列表验证和异库恢复通过。细节与环境限制见 [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md)。

### M0：优先安全封堵

- [x] **S01 / P0 字段授权与授予范围**
  - [x] 通用用户更新移除 role_ids/status/department_id，大小写绕过与未知字段拒绝；专用调岗端点只接受 department_id。
  - [x] 创建初始角色/部门增加额外 API 能力检查；单用户调岗端点和种子权限已对齐。
  - [x] 后端按 API 能力作 AND 检查；admin 角色仅超管可授予，非超管授予不得超出自身有效 API 范围。
  - [x] 角色授权与权限 Path/Method 改写检查最终范围，角色/权限关联 ID 在事务中验证。
  - [x] 验收：低权限资料编辑账号无法改授权字段；创建、角色授权和权限改写越权用例均拒绝。证据：下方 M0 定向测试。
- [x] **S02 / P0 安全初始化**
  - [x] 种子不创建公开口令；提供显式一次性 `bootstrap-admin`，无口令/弱口令失败，不会覆盖已有账号口令。
  - [x] 生产 JWT 与目录加密密钥拒绝空值/默认值/弱 JWT；开发测试凭据由测试装配显式提供。
  - [x] `rotate-admin-password` 为旧安装提供显式轮换并撤销旧凭据；README 说明先升级再执行，普通重启不改密。
  - [x] 存量 SQLite 与临时 PostgreSQL 17 均用旧版 `users`/`roles` 表结构演练迁移；验证普通启动保留原口令、显式轮换递增 `auth_version` 并使旧口令失效，捕获的启动日志不含测试口令。数据库为隔离临时实例，未连接部署库。
- [x] **S04-A / P0 SSE 最小授权封堵**（归属 S04）
  - [x] SSE 订阅入口按目录同步日志读取权限拦截；低权限用户访问事件端点返回 403。
  - [x] 公开推送去掉用户名、DN 与原始错误；受控同步日志接口保留敏感明细。
  - [x] 验收：低权限账号无法订阅；敏感载荷边界已按事件构造路径检查。撤权后的活跃连接复核属于后续 S04 完整阶段。
- [x] **U01-A + U03-A / P0 授权弹窗安全保存**（归属 U01/U03）
  - [x] 角色详情或权限树失败显示重试并禁用保存；切换角色不沿用旧选择。
  - [x] 草稿只从成功读取初始化，后台 refetch 不覆盖正在编辑的选择；revision 冲突保留草稿并要求比较确认。
  - [x] Playwright 实测权限树 403/500/断网及角色详情 500 均禁用保存且不发送授权请求；验证角色切换隔离草稿，以及模拟另一管理员更新后的 revision 冲突、最新授权比较和显式确认提交。

**M0 定向验收（2026-10-22）**：后端 M0 安全、迁移与 API 定向用例通过（包含 `TestLegacySQLiteAdminKeepsPublicPasswordUntilExplicitRotation`、`TestLegacyPostgresAdminKeepsPublicPasswordUntilExplicitRotation`）；PostgreSQL 用 `postgres:17-alpine` 隔离容器运行。`cd frontend && npm run build` 通过；`cd frontend && npm run test:e2e` 通过（6/6，Playwright，API 全部使用可控 mock）；`git diff --check` 通过。未运行全量 Go 套件，其他未覆盖项见阶段状态。

### M1：认证、数据语义与并发更新正确性

- [x] **V01 / P1 版本化迁移与接口兼容基础**（验收：SQLite/PG 新旧库迁移、重复检测、升级运维说明）
  - [x] 迁移编号、字段回填、重复执行检测、新/存量数据库验证机制。
  - [x] auth_version、edit_revision、组织/授权状态、Outbox 与 LDAP task request_id 按里程碑渐进迁移。
  - [x] 保留现有用户状态 API 对省略 expected_revision 的兼容，同时让新版前端使用 CAS；权限同步新路由纳入种子。
  - [x] 补齐备份、凭据失效、禁止不兼容混跑、前向修复/网关隔离步骤。
- [x] **S03 / P1 认证版本与旧凭据撤销**
  - [x] Session/Access/Refresh 签发和认证均绑定 auth_version；旧格式缺少有效版本时拒绝。
  - [x] 停用/改密原子递增，启用不回退；LDAP 停用使用同一 repository 更新规则。
  - [x] 前端启停提示说明撤销会话；撤销操作只重新启用账号，不恢复旧会话。
  - [x] 验收：Cookie、Access、Refresh 在停用再启用后全失效；新凭据可用；Refresh 并发重放仅一请求成功。
- [x] **S07 / P1 错误、日志与追踪**
  - [x] request_id 来自统一 Context 元数据，响应、HTTP 日志、GORM 日志保持一致；错误分类不写响应。
  - [x] GORM slog 启用参数化日志；LDAP 异步日志持久化 task/operator/request ID。
  - [x] 会话删除、目录锁释放、SSE 写入/编码、资源关闭失败均有可观察日志；偏好部分失败返回 503 并明确偏好已保存。
  - [x] 定向验证覆盖真实 400/401/403/404/409/500 返回及 request_id；验证访问日志与 409 响应状态/业务码/request_id 一致，并验证偏好部分失败的 503 响应数据。
- [x] **D01 / P1 清空与缺失字段语义**
  - [x] 普通文本字段缺失不变、显式空字符串清空；email 空值仍因格式不合法被拒绝。
  - [x] 部门接口区分缺失、UUID、null、空字符串；资料与调岗入口拆分，统计/列表按数据库新值刷新。
  - [x] 验收：真实 API 回归确认清空、设置、拒绝语义。
- [x] **D02 / P1 角色服务端分页**
  - [x] PageData 保留分页元数据，query key 含分页和筛选参数，列表使用服务端 pagination/filtering。
  - [x] 统计卡片说明总数/当前页口径，删除末页最后一条回退到有效页，刷新失败保留旧数据并显示错误。
  - [x] 验收：150+ 角色分页及第 100 条后的关键词搜索通过后端 API 回归；Playwright 覆盖第 100 条后搜索、末页删除回退，以及刷新失败时保留行并展示错误。
- [x] **D03 / P1 用户复合写事务**
  - [x] 创建与初始角色写入同一事务，关联 ID 完整校验，重复 ID 幂等；唯一约束仍由数据库兜底并映射 409。
  - [x] 失败角色创建不会残留账号；内置管理员保护保持有效。
  - [x] 验收：API 关联校验及 repository 事务回滚回归通过。
- [x] **U04 / P1 并发安全乐观更新**
  - [x] 用户/角色状态请求带 expected_revision 并通过数据库 CAS；用户状态 API 对旧客户端保留兼容。
  - [x] 按用户/角色行快照乐观更新，失败只恢复未被后续 revision 替换的目标行；成功合并服务端返回值并失效统计/列表。
  - [x] 撤销作为新授权请求，携带服务端最新 revision；同实体操作 pending 时禁用/串行，不同实体可并行。
  - [x] Playwright 验收：A 行失败保留 B 行成功；同一用户待处理和撤销 revision 正确。

### M2：数据库并发、策略收敛与实时通道

- [x] **S05 / P1 部门结构与调岗一致性**
  - [x] 领域 UnitOfWork、organization_state revision 串行写入，SQLite/PG 仓储实现及有界锁冲突重试。
  - [x] 创建/移动/删除/排序/LDAP 建部门/人员调岗接入同一事务协议。
  - [x] 事务内循环、深度、唯一与删除保护，资料更新不覆盖结构字段。
  - [x] 批量调岗完整校验、稳定锁顺序和影响行数不符回滚。
  - [x] 树 revision/expected_revision/409 契约与有界忙等待处理。
  - [x] 验收：反向移动、删除与调岗、LDAP 交错均通过 SQLite 和 PostgreSQL 17 屏障并发测试。
- [x] **S06 / P1 授权同事务提交与多实例一致性**
  - [x] 角色关联、派生策略、授权 revision、Outbox 同事务；注入 Outbox 故障验证无半提交。
  - [x] 请求核对 revision、本地稳定策略加载和失败关闭；Casbin Enforcer 禁止自动保存未提交策略。
  - [x] Outbox 幂等发布与失败退避、Redis 跨实例刷新通知、请求 revision 核验和启动/断线补偿。
  - [x] 验收：双实例撤权立即拒绝；无通知时 revision 核验收敛；策略加载失败、数据库读取失败、Outbox 写故障与通知重试有验证。
- [x] **S08 / P1 路由权限防漂移**
  - [x] 路由 public/auth-only/RBAC 显式分类及 API 路由覆盖断言。
  - [x] 同步按 Method+路径模板报告新增/失效/重复/字段漂移。
  - [x] 幂等同步接入授权事务；新增接口不自动授权，不自动删自定义权限。
  - [x] 验收：连续同步、动态路由变更、权限 Path 改写和并发同步回归通过。
- [x] **S04-B / P1-P2 SSE 生命周期与恢复**（完成后汇总 S04）
  - [x] Redis Stream 事件存储、领域发布/读取接口、身份/会话绑定与连接生命周期管理。
  - [x] 订阅按权限拦截，周期复核会话、auth_version、权限和绝对期限，不续期会话；跨实例 Redis 通知/事件流可恢复。
  - [x] 有界流读取、事件 ID/保留窗口、Last-Event-ID、滞后或保留缺口触发快照刷新。
  - [x] 前端身份代际隔离、带抖动退避重连、通知/查询缓存清理和过期停止重连。
  - [x] 验收：会话注销/到期/版本撤销、账号切换、跨实例读取/重连和迟到事件隔离均有定向验证。

**M2 验收证据**：定向 Go 测试覆盖 SQLite 和临时 PostgreSQL 17 的组织 revision 冲突、反向移动、删除/调岗和 LDAP 交错；SQLite Outbox 故障原子回滚、SQLite/PostgreSQL 角色策略事务、发布失败退避/成功幂等、Redis 双实例通知、双 Casbin 实例撤权与策略/数据库失败关闭；API 路由分类/同步漂移与并发幂等；Redis Stream 跨实例回放/保留缺口、会话只读复核、SSE JSON 注入边界。`frontend npm run build` 与 Playwright 两个 SSE 重连/账号切换用例通过。另运行 `go test ./... -run '^$'` 编译全部后端包和 M2 定向回归；未运行全量 Go 套件，以避免重复低价值测试。

### M3：可靠前端基础与可访问性

- [x] **U01 / P1 查询状态全面接入**
  - [x] QueryState 区分首次加载/错误/403/空数据/后台失败，覆盖六个页面和详情浮层。
  - [x] keepPreviousData 标注占位期，禁用依赖旧集合的批量操作。
  - [x] Dashboard 不以 0 伪装失败，提供更新时刻与重试。
  - [x] 验收：Dashboard 首次 500 与手动恢复、授权树 403/500/断网及角色详情错误均通过浏览器验证；M0 U01-A 继续有效。
- [x] **U02 / P1 草稿与离开保护**
  - [x] Data Router 按唯一叶子页面注册，保持权限、懒加载、重定向和滚动行为。
  - [x] 单一集中 dirty 注册器保护 Dialog/Sheet 关闭、路由 blocker 与 beforeunload。
  - [x] 保存中/保存失败/成功状态正确处理；确认弹窗队列串行；敏感草稿不持久化。
  - [x] 验收：权限草稿 Esc/遮罩/取消/浏览器后退有确认且焦点恢复；beforeunload 事件可取消。侧栏与命令使用相同路由拦截器，未另做重复的点击路径用例。
- [x] **U03 / P1 权限差异配置**
  - [x] 完整树计算三态，搜索结果操作与全模块操作明确区分。
  - [x] 后代索引、差异清单、清空确认、无变更禁提交。
  - [x] 角色 revision 冲突保留草稿并要求比较/明确确认后重试。
  - [x] 验收：过滤操作不误改隐藏节点，查询失败禁保存，管理员并发冲突保留草稿；包含 U01-A。
- [x] **U09 / P1-P2 动效、通知与无障碍基础**
  - [x] reduced-motion、语义状态、骨架 shimmer 与动态反馈遵循用户偏好。
  - [x] 浮层标题/焦点、图标按钮名称、表单错误关联和适量 aria-live 已补齐。
  - [x] 显式已读、重连提示及用户主动启用的声音/桌面通知。
  - [x] 验收：键盘焦点/关闭、明暗主题、减少动态效果、390px 窄屏无横向溢出已用 Playwright 检查。
  - [x] 人工验收：使用 VoiceOver 或 NVDA 对登录、数据表格和授权对话框做读屏抽查。

### M4：高频管理效率

- [x] **U05 / P2 表格交互增强**
  - [x] 吸底批量栏与安全区，默认当页选择；换页/查询范围变化清空选择。
  - [x] UUID 锚点 Shift 范围选择，查询占位数据期间禁选；固定列支持键盘调宽/重置。
  - [x] 列宽、可见性、固定列偏好按用户/表格/schema 隔离保存；用户昵称支持行内编辑与 revision 冲突保稿重试。
  - [x] 验收：Playwright 覆盖范围选择、换页清空、列宽键盘调整/偏好持久化、昵称并发冲突；虚拟化仍按 P3 性能门槛评估。
- [x] **U06 / P1-P2 部门树增强**
  - [x] roving tabindex、方向键/Home/End、名称/编码搜索高亮、结果计数与定位。
  - [x] 拖拽 before/after/inside、循环目标拦截与影响预览；保留“移动到…”和上下排序作为键盘/触控替代。
  - [x] 相对移动携带 `expected_revision` 并在一个组织树事务内重排；409 重载而不乐观挪动节点。
  - [x] 验收：Playwright 覆盖键盘搜索/焦点与浏览器内 `dragstart`/`dragover`/`drop` 事件流、相对位置请求；服务端覆盖跨父排序和 revision 冲突原子性。
- [x] **U08 / P2 命令面板扩展**
  - [x] 从 Header 抽离全局命令面板，支持权限过滤导航、快捷创建、实体搜索、主题与最近访问。
  - [x] 实体搜索使用精确 API 权限码，至少 2 字、300ms 防抖、AbortSignal 取消与结果限制。
  - [x] Cmd/Ctrl+K 避开输入控件、输入法组合和已有对话框；命令跳转复用 dirty guard。
  - [x] 验收：Playwright 验证授权/未授权实体搜索、快捷键范围、详情跳转和最近访问记录。

### M5：LDAP 可恢复任务体验

- [x] **U07 / P2 同步向导、计划与 Diff**
  - [x] 手动全量/增量同步统一走检查→预览→确认→执行；原“立即同步”入口只打开预览，不绕过禁用用户等高风险变更确认。
  - [x] 持久化 `plan_id`、10 分钟有效期、配置更新时间、目录/本地记录指纹与摘要；敏感明细按权限分页返回 Before/After Diff。
  - [x] 执行时重读目录和本地数据校验计划；配置/目录/记录变化或过期返回 409，前端要求重新预览；幂等键按配置与操作者复用原任务；用户资料 CAS 冲突作为部分失败说明。
  - [x] 任务明细使用独立 API 权限；摘要列表不暴露 DN/逐条原因；计划/任务快照写入数据库；owner lease 心跳与 fencing 确保丢租约后不再写入，过期任务可被恢复为失败终态。
  - [x] 进度快照记录阶段、处理量和计划总数；按进度节流持久化与 SSE 推送，完成后先写终态再发布终态事件；刷新后从任务列表/详情快照恢复。
  - [x] 预览时清理过期计划，定时任务也清理；SSE 事件仅含版本化计数/错误代码，不携带 DN 等明细；通知客户端兼容旧版 `stage/completed` 事件；失败项通过重新预览生成新计划后重试。
  - [x] 验收证据：`go test ./internal/service ./internal/repository ./internal/bootstrap -run 'TestBuildSyncPlanClassifiesEveryDirectoryEntry|TestDirectorySyncPreviewRunAndIncremental|TestSyncLockAndSchedulerOnlyStartDueWork|TestLDAPPreviewChangesAndExpiryRequireRepreview|TestLDAPTaskDetailsArePermissionGatedAndStaleLeaseIsRecovered|TestMigrationLedgerSkipsCompletedBackfill|TestLDAPTaskMigrationPreservesLegacySyncRows|TestPermissionRouteSync' -count=1`；`npm run build`；`M5_CAPTURE=1 PLAYWRIGHT_BROWSERS_PATH=/private/tmp/infranexus-pw-browsers npx playwright test e2e/m5-ldap-recoverable.spec.ts`（1/1）。覆盖计划过期/版本变化、重复请求、旧任务恢复/lease fencing、诊断越权与脱敏、部分失败、预览 Diff/二次确认和浏览器刷新恢复。旧 PostgreSQL 结构迁移已在 M6 隔离实例验证；真实 LDAP 部署演练留作 Staging 验收。

### M6：最终验证与发布准备

- [x] **V02 / P1-P2 后端完整矩阵**：完整 Go race/vet；SQLite、临时 PostgreSQL 17 并发与存量迁移、Redis 8 跨实例通知/Stream；授权、撤销、故障回滚、组织树、SSE、LDAP 计划/任务和日志覆盖。真实目录服务器仍需 Staging 验收。
- [x] **V03 / P1-P2 前端与浏览器矩阵**：Vitest 17/17、Playwright 22/22；六模块失败状态、表单防丢、表格/树/命令/LDAP 任务流程、320/768/1440/2560px、浅/深色、reduced-motion 与键盘焦点；浅色无 Axe 违规，深色 serious/critical 为零。VoiceOver/NVDA 人工读屏仍是部署前检查。
- [x] **V04 / P2 性能与发布记录**：固定环境下测量 100 行表格、500 条预览、1k/10k 部门树和 PG/Redis 关键路径；版本化迁移、旧凭据撤销、PG dump/恢复验证；README、API、架构和测试命令同步。生产网关关闭写入/回退开关不在此本机环境，必须由目标环境负责人演练后才可开放流量。
- [x] **P3 可选能力门槛（评估完成）**：实测证明 10k 部门树有秒级长任务，建议在服务超大组织前虚拟化；目前未实现，也不宣称支持 10k 流畅渲染。跨页选择另立契约。

### 完成证据登记模板

```text
任务 ID：
执行人 / 分支 / 关联提交或 PR：
变更与行为：
验证命令、环境与结果：
浏览器 / 双数据库 / 双实例证据（适用）：
迁移、兼容与回退影响：
未覆盖与后续项：
```

## 历史交付记录（以下不作为本轮重新验收结果）

---

## 阶段一：项目工程骨架与基建初始化 (Phase 1: Foundation Setup)
- [x] **1.1 根目录与双工程结构初始化**
  - [x] 创建 `backend/` 与 `frontend/` 目录
  - [x] 后端初始化 `go.mod` (Go 1.27+, Module: `infranexus`)
  - [x] 前端使用 Vite 8 + React 19 + TypeScript 初始化工程
  - [x] 根目录配置统一的 `.gitignore` 与开发启动快捷命令 (`Makefile` 或 `package.json` scripts)
- [x] **1.2 后端核心基建搭设**
  - [x] 集成 `viper` 配置中心 (`internal/config/config.go`，解析 `config.yaml` 及环境变量)
  - [x] 集成 `log/slog` 结构化日志工具封装 (`internal/core/logger/logger.go`)
  - [x] 集成 GORM 双引擎初始化器 (`internal/bootstrap/database.go`)，支持 SQLite 与 PostgreSQL 自动无缝切换与连接池配置
  - [x] 引入 `gorm.io/datatypes` 并支持 `datatypes.JSONType[T]` 泛型 JSONB 字段
  - [x] 集成 Redis 客户端初始化器 (`internal/bootstrap/redis.go`)
  - [x] 封装 Fiber Storage 统一驱动工厂 (`internal/storage/factory.go`，支持 `memory`, `sqlite3`, `postgres`, `redis`, `s3`)
  - [x] 封装与领域业务状态码强绑定的泛型统一响应格式 (`internal/core/response/response.go`：`Success[T]`, `Page[T]`, `Error` + 业务状态码常量如 `CodeSuccess=200000`, `CodeTokenExpired=401001` 等)
  - [x] 封装请求验证器 (`internal/core/validator/validator.go` 基于 `go-playground/validator`)
  - [x] 封装全局错误拦截器 (`internal/core/errors/` 与 Fiber `ErrorHandler`)

---

## 阶段二：GoFiber v3 中间件流水线、认证双通道与泛型仓储 (Phase 2: Backend Core & Auth)
- [x] **2.1 中间件管线集成**
  - [x] 集成 `gofiber/middleware/recover`
  - [x] 集成 `gofiber/middleware/requestid` (透传与注入 Context)
  - [x] 集成 `gofiber/middleware/responsetime`
  - [x] 集成 `gofiber/middleware/cors` (支持自定义 AllowedOrigins 与 Credentials 跨域 Cookie 携带)
  - [x] 集成 `gofiber/middleware/logger` (与 slog 桥接输出带 RequestID 的日志)
  - [x] 集成 `gofiber/middleware/sse` (构建实时长连接通知端点)
  - [x] 构建**双通道认证中间件**：Web 端优先解析 HttpOnly Session Cookie (并自动执行滑动窗口延期)；第三方/开放接口优先解析 Header `Authorization: Bearer <JWT>`
  - [x] 集成 `gofiber/contrib/casbin` (基于 RBAC 规则拦截 API 资源)
- [x] **2.2 核心领域实体与泛型三层解耦接口设计 (全表 UUID 主键与 JSONB)**
  - [x] `domain/base.go`: `BaseEntity` 全局嵌入 UUID 主键（结合 Go 1.27+ 自带/标准 UUID 库并提供 `BeforeCreate` 自动发号）与 `Repository[T any, ID comparable]` 泛型仓储基类接口
  - [x] `domain/user.go`: 用户模型（包含 UUID 主键、`datatypes.JSONType[UserPreferences]`、多对多 `sys_user_roles` UUID 外键）、`UserRepository` 与 `UserService` 接口
  - [x] `domain/role.go`: 角色与 Casbin 模型定义（UUID 主键）、`RoleRepository` 与 `RoleService` 接口
  - [x] `domain/permission.go`: 权限菜单树与操作点实体定义（UUID 主键）
- [x] **2.3 Repository 持久化层实现**
  - [x] `repository/user_repository.go`: 基于泛型 GORM 的 CRUD 与角色关联查询
  - [x] `repository/role_repository.go`: 角色持久化与关联 Casbin 策略规则写入
  - [x] `repository/permission_repository.go`: 权限与菜单树查询
- [x] **2.4 Service 业务逻辑层实现**
  - [x] `service/auth_service.go`: 密码哈希、Session 会话创建与 Redis 缓存、JWT Token 颁发、登出与黑名单销毁
  - [x] `service/user_service.go`: 用户注册/创建、修改、偏好设置更新、启停、分派角色
  - [x] `service/role_service.go`: 角色维护与权限矩阵绑定
- [x] **2.5 Handler HTTP 接入层实现与路由挂载**
  - [x] `handler/auth_handler.go`: 登录、登出、会话状态检测、Token 颁发
  - [x] `handler/user_handler.go`: 用户分页列表、创建、修改、删除、状态切换
  - [x] `handler/role_handler.go`: 角色列表与权限分配
  - [x] `handler/sse_handler.go`: SSE 客户端连接与事件广播通道
  - [x] 精简 `cmd/server/main.go`，通过装配器注入各层依赖并启动 HTTP 监听

---

## 阶段三：前端全宽 SaaS 布局、Base UI 网格与组件集成 (Phase 3: Frontend Layout & Data-Table)
- [x] **3.1 前端样式与 UI 基础搭建**
  - [x] 安装并配置 Tailwind CSS v4 与 CSS 变量主题系统 (暗黑/明亮无感切换)
  - [x] 安装 `@base-ui/react`, `@shadcn/react`, `lucide-react`, `clsx`, `tailwind-merge` 等核心原子包
  - [x] 基于 `@base-ui/react` 封装通用原子组件 (Button, Input, DropdownMenu, Dialog, Badge, Sheet 等)
  - [x] 确立 12 列响应式代码网格规则 (`grid grid-cols-12 gap-4 md:gap-6`)
- [x] **3.2 企业级数据表格深度整合**
  - [x] 将 `@[/Users/liangyx/Documents/GoProject/storage-net/frontend/src/components/data-table]` 完整引入并适配：
    - [x] `data-table.tsx`
    - [x] `data-table-column-header.tsx`
    - [x] `data-table-pagination.tsx`
    - [x] `data-table-toolbar.tsx`
    - [x] `data-table-faceted-filter.tsx`
    - [x] `data-table-date-range-filter.tsx`
    - [x] `data-table-view-options.tsx`
    - [x] `data-table-skeleton.tsx`
    - [x] `data-table-empty.tsx`
    - [x] `types.ts` & `index.ts`
- [x] **3.3 SaaS 管理后台流式全宽布局设计**
  - [x] 顶部导航区 (`Header`): 面包屑、全局搜索 (`Cmd+K`)、主题切换、用户下拉头像
  - [x] 侧边栏导航 (`Sidebar`): 桌面端可折叠 (展开/紧凑 Mini 模式)、移动端抽屉式滑动唤出
  - [x] 主画布区域 (`Main`): 全宽度流式自适应 (`w-full min-h-screen`)，在大屏 (2K/4K) 上铺满展开，杜绝居中收窄限制

---

## 阶段四：前端业务模块与交互闭环 (Phase 4: Frontend Business & Auth Flow)
- [x] **4.1 网络请求与无感刷新拦截器**
  - [x] 封装 Axios 实例 (`src/services/api.ts`)
  - [x] 实现 401 拦截无感刷新 AccessToken + 挂起请求队列 (Failed Queue) 重放机制
  - [x] 实现客户端 Auth Store 与本地持久化记录当前登录用户及权限列表
- [x] **4.2 核心业务页面实现**
  - [x] 登录页面 (`pages/auth/login.tsx`): 现代化 SaaS 设计、表单校验、登录成功跳转
  - [x] 控制台概览页 (`pages/dashboard/index.tsx`): 状态指标与实时系统图表展示
  - [x] 用户管理页 (`pages/users/index.tsx`):
    - [x] 接入 `DataTable` 组件，支持分页、排序、状态筛选、角色筛选
    - [x] 新建/编辑用户弹窗 (Dialog) 与状态开关切换
  - [x] 角色管理页 (`pages/roles/index.tsx`):
    - [x] 角色列表与新建/编辑
    - [x] 角色权限树状勾选面板 (树状复选框分配菜单与操作权限)
  - [x] 权限管理页 (`pages/permissions/index.tsx`): 菜单与 API 资源结构展示
  - [x] SSE 实时消息接收监听：在顶部通知中心实时呈现后端推送的事件通知

---

## 阶段五：联调、验证与脚手架工程交付 (Phase 5: Verification & Delivery)
- [x] **5.1 数据库双引擎验证**
  - [x] 验证 SQLite 驱动下一键启动生成数据文件与初始化管理员账号
  - [x] 验证 PostgreSQL 驱动配置连接并在启动时成功执行自动迁移 (AutoMigrate)
- [x] **5.2 认证与权限全链路测试**
  - [x] 验证登录签发双 Token、登出 Token 黑名单失效机制
  - [x] 验证 AccessToken 过期后，前端静默完成 Token 刷新，用户操作无感延期
  - [x] 验证 Casbin RBAC 中间件对于非授权角色的 403 阻断行为
- [x] **5.3 响应式全宽测试**
  - [x] 验证在超宽屏 (≥1920px) 下，数据表格与主面板全宽度自适应展开
  - [x] 验证在移动端 (<768px) 下，侧边栏抽屉折叠、移动端手势与表格横向平滑滚动
- [x] **5.4 编写快速启动与部署文档**
  - [x] 编写根目录 `README.md`，提供一键初始化与开发启动命令指引

---

## 优先整改（2026-10-20）

历史实施契约见 [具体实施方案](PRIORITY_REMEDIATION_PLAN.md)。以下勾选是旧轮次记录；2026-10-22 的执行状态以本文顶部看板为准。

- [x] P0.1 分离 Web Session 登录与外部 JWT Token 端点，移除登录 JSON 中的会话凭据。
- [x] P0.2 严格 Bearer 优先且失败不回退；校验 JWT 用途、issuer、期限、撤销。
- [x] P0.3 刷新令牌原子轮换、防重放；退出撤销当前令牌族。
- [x] P0.4 Session 空闲/绝对过期、Cookie 同步续期、重新登录替换旧会话。
- [x] P0.5 当前用户状态/角色校验，CSRF/CORS 来源配置与登录限流。
- [x] P0.6 认证接口进入 domain，状态存储进入 repository，移除认证 Handler 越层访问。
- [x] P0.7 前端纯 Cookie 认证、移除本地 Token/刷新队列、身份恢复和错误处理。
- [x] P1.1 统一业务码 HHHCCC，修订三个主文档、README 与过时示例。
- [x] P1.2 后端认证回归、并发与存储异常验证；前端构建与认证流程验证。
- [x] P1.3 记录实际验证命令、结果和未覆盖事项。
- [x] P2 版本化迁移、双数据库契约测试、生产初始化与跨实例一致性（后续）。
- [x] P3 CI、审计、监控、恢复、性能基线及按需多租户（后续）。

---

## 企业组织与目录集成（2026-10-21）

分支 `feat/enterprise-org-ldap`，按 Step 1–6 分次提交。以下勾选均有本轮测试或浏览器验收证据。

- [x] Step 1 缺陷修复：请求校验绕过、角色筛选 500、软删除后用户名/邮箱/编码无法复用（改为部分唯一索引并迁移旧索引）、权限树丢失子节点。
- [x] 部门树：TreePath 物化路径（≤15 级）、负责人/排序/移动、子部门与成员删除保护。
- [x] 用户部门关联：部门筛选（可含下级）、`POST /api/v1/users/batch-move-department` 事务化批量调岗。
- [x] AD/LDAP：配置（绑定密码 AES-GCM 加密）、连接测试、同步预览、手动全量/增量同步与定时全量同步、OU/属性映射部门、同步日志与 SSE 通知。
- [x] 多源域认证：登录携带 `domain`，用户 DN 绑定校验、JIT 建档、失败统一 `401002 域认证账号或密码错误`。
- [x] 用户/角色/权限补全：重置密码与会话撤销、多角色、内置保护、角色授权面板、成员列表、权限点 CRUD、路由同步至 Casbin、前端按钮/页面级权限。
- [x] UI/UX：AlertDialog 二次确认 + Toast、统计卡片、来源徽标、状态开关、空状态与骨架屏；亮/暗色、1440/2560 宽屏、移动端浏览器验收。
- [x] 验证：`go vet ./...`、`go test -count=1 ./...`、`go test -race ./...`（49 个测试函数）、`npm --prefix frontend run build`、`npm --prefix frontend test`（16 项）全部通过。

已知限制：
- [x] Casbin 鉴权中间件为 contrib 同形自研实现：`gofiber/contrib/casbin` 依赖 casbin/v2，与本项目 casbin/v3 不兼容。
- [x] 策略修改只刷新当前进程的 Enforcer，多实例需重启或另行实现策略广播（同 P2「权限策略跨实例一致性」）。
- [x] 本轮自动化测试与验收只覆盖 SQLite，PostgreSQL 未验证。
