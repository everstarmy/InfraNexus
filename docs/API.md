# API 行为与实时事件契约

本文记录当前 `/api/v1` 的认证、并发冲突和 LDAP 可恢复同步契约，供前后端与集成客户端共同使用。路由权限仍由 Casbin 按方法和路由模板执行；公开路由与登录/令牌路由除外。

位置、IPAM、制造商与供应商接口见 [基础管理 API](DCIM_MANAGEMENT_API.md)。

## 响应与认证

成功和失败响应统一包含 `code`、`message`、`data`、`request_id` 和 Unix 秒级 `timestamp`。分页数据位于 `data.items`，并带 `total`、`page`、`page_size`。`request_id` 同时用于响应、请求日志和后台 LDAP 任务日志。

浏览器使用 HttpOnly Cookie；登录后通过 `GET /api/v1/auth/me` 恢复当前身份。Cookie 认证的写请求必须带 `security.trusted_origins` 中精确匹配的 `Origin`，或同源 `Referer`。外部客户端通过 `POST /api/v1/auth/token` 获取 Bearer 凭据，并使用 `POST /api/v1/auth/refresh` 轮换；不要把 Web Cookie 和 CLI Token 存进同一浏览器存储流程。

领域错误的 HTTP 状态与业务码对应，例如参数错误 `400001`、凭据无效 `401002`、权限不足 `403001`、资源不存在 `404xxx`、冲突 `409xxx`。并发冲突不会覆盖服务器新值；客户端应保留草稿并基于最新版本重新确认。

`PUT /api/v1/users/:id` 更新用户资料必须携带正整数 `expected_revision`。Web 表单与行内昵称编辑均按用户资料的 `edit_revision` 执行 CAS；缺少版本返回参数错误，版本过期返回 409。旧集成客户端需在此版本上线时同步增加该字段，资料更新不再提供无条件写入兼容路径。

目录配置的 `timeout_seconds` 约束单次目录网络操作，允许 `0`–`60` 秒，省略或传 `0` 时使用 `10` 秒。LDAP 账号认证与连接测试各自有固定 `30` 秒总预算；目录全量/增量搜索使用固定 `10` 分钟总预算，覆盖连接、服务账号绑定和全部分页。请求或任务取消会关闭 LDAP socket。超出总预算的搜索会失败，不得将未完整目录结果用于停用缺失账号。

## LDAP 审阅与任务 API

每个目录配置对应一个唯一的 `domain`，不同域的同名账号分别建档。配置中的 `enabled` 仅控制该域是否接受新登录；`sync_enabled` 独立控制定时同步，关闭登录仍可预览、手动同步或按原策略定时同步。`GET /api/v1/auth/domains` 只返回允许登录的域，直接调用 Web 登录或 Token 接口也不能绕过关闭状态。关闭域登录不主动撤销此前签发的 Session / Token，已有凭据继续遵守原有有效期、账号状态及撤销规则。

身份源页面通过分页表格展示多个域，支持名称/域名/服务器搜索、目录类型和登录状态筛选；每行的「配置登录」进入对应域的「同步与登录」设置。完整连接和映射信息按需展开，日志可独立按域筛选。

列表与详情中的登录开关调用 `PATCH /api/v1/ldap/configs/:id/status`，请求为 `{ "enabled": false }`（或 `true`），响应返回完整目录配置；缺少 `enabled` 返回参数错误。权限清单将该接口列在「身份源集成 → 变更域登录状态」（`ldap:toggle-status`）下，API 编码为 `api:PATCH:/api/v1/ldap/configs/:id/status`。列表开关按此 API 的有效权限启用；只有旧 `ldap:update` / PUT 权限的角色仍可通过编辑配置设置登录策略，不会自动获得新接口授权。种子升级保留已有 API ID 与角色授权，并将旧「切换目录启用状态」条目调整到新按钮节点下。

手动同步必须按“预览、审核、执行”分步完成。旧的立即同步入口也只会生成预览。

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/v1/ldap/preview` | 请求 `{ "config_id": "<uuid>", "mode": "full" }` 或 `incremental`；重新读取目录和本地资料，计算并持久化有效期 10 分钟的计划，返回摘要、首屏差异及计划 ID。 |
| `GET /api/v1/ldap/sync-plans/:id/items?page=1&page_size=50` | 按页读取受保护的 Before/After 差异明细。此权限与任务摘要分离；普通任务列表不返回 DN 和逐条失败原因。 |
| `POST /api/v1/ldap/sync` | 请求 `{ "config_id": "<uuid>", "mode": "full", "plan_id": "<uuid>", "idempotency_key": "<16-128 chars>" }`；重新核验配置版本、目录/本地数据指纹与计划所有者后，创建后台任务并返回初始快照。 |
| `GET /api/v1/ldap/sync-logs?page=1&page_size=10&config_id=<uuid>` | 查询可恢复的任务摘要和当前进度快照。 |
| `GET /api/v1/ldap/sync-logs/:id` | 读取持久化任务报告与终态。 |

计划过期、配置/目录/本地资料变化或请求与计划不匹配时，执行返回 HTTP 409（业务码 `409001`），前端需重新预览并再次确认。对同一配置、操作者和计划重复提交同一幂等键会返回原任务；把该幂等键用于另一计划会返回冲突。任务运行中由数据库 lease 和 fencing 保护，进度快照可在页面刷新后恢复。失败项需重新预览生成新计划后重试，不提供跳过审核的重放入口。

## SSE 事件

`GET /api/v1/sse/notifications` 使用当前 Session 或 Bearer 身份，且要求同步日志读取权限。客户端以 `Last-Event-ID` 请求断点续传；也可在无 Header 的环境使用 `lastEventId` 查询参数。Redis 保留窗口已越界或消费者积压超限时，服务发送 `snapshot.required`，客户端应读取普通 REST 快照后再恢复订阅。服务端周期性复核会话版本和权限，身份过期时发送 `auth.expired` 并关闭连接。

LDAP 事件使用版本化、仅计数的负载：

- `ldap.sync.started`：`schema_version`、`event_id`、`task_id`、阶段、模式和时间。
- `ldap.sync.progress`：任务 ID、阶段、已处理量/总量、成功/跳过/失败计数、时间与错误代码。
- `ldap.sync.finished`：最终状态、计数和结果可查询提示。

实时事件不包含用户 DN、账号差异、逐条失败原因或原始目录错误；这些内容只能通过有权限的计划明细或同步日志接口读取。事件由持久化任务快照支撑，浏览器应把 SSE 当作刷新提示与进度信号，而不是唯一数据源。

## 脚手架稳定性收尾（2026-10-24）

- `GET /api/v1/health`：公开存活检查，保留原响应。
- `GET /api/v1/ready`：公开就绪检查，成功 `200000` 与 `{status:"ready"}`，依赖未就绪返回 HTTP 503、业务码 `503002`，不输出驱动诊断。沿用 request_id。
- 前端重新激活窗口、恢复可见或收到业务 403 时，可后台更新 `/auth/me`；5 秒内合并请求，不切换全页加载、不丢弃表单草稿。后台网络/500 错误保留当前身份，401 清理；`/auth/*` 的 403 不触发递归刷新。
- 同步报告及其幂等响应默认保留至任务结束后 90 天；清理批次可能延后实际回收时间。保留期内重复请求仍返回原任务；窗口外需重新预览、使用新的请求 ID，旧预览不可重放。期限可配置，见 [部署说明](DOCKER.md)。
