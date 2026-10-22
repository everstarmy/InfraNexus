# 优先整改实施方案

> 历史方案：本文保留 2026-10-20 的背景与实施契约。当前整改范围与执行顺序见 [2026-10-22 问题处理与交互改造方案](REMEDIATION_AND_UX_PLAN.md) 和 [当前看板](TODOLIST.md)。本文中的工作区、人员分工和待实施判断是当时记录，不作为当前执行指令。

日期：2026-10-20。负责人：主智能体制定方案，Sol / medium 实施和验证。

## 目标与范围

本轮 P0/P1 聚焦认证闭环、业务码规则及文档一致性。保留已有页面和三层架构，不做 UI 重设计、技术栈升级或多租户扩展。工作区当前文件均未跟踪；不得清理、覆盖无关资产或自动提交。

核查发现：Web 同时使用 Cookie 与 localStorage Token；登录 JSON 泄露 session_id；无效 Bearer 可回退 Cookie；JWT access/refresh 无用途区分，ValidateJWT 不查询撤销状态；内存会话无 TTL；续期只延长服务端而不更新浏览器 Cookie；Handler 直接依赖 UserRepository。文档 Axios 缺陷与实际代码不完全一致，按当前代码修复。

## 一、认证契约（本轮必须完成）

- POST /api/v1/auth/login：Web 登录，只返回 data.user，并设置 HttpOnly Cookie；不得返回 Session ID、AccessToken、RefreshToken。重新登录撤销当前浏览器旧会话。
- GET /api/v1/auth/me：统一身份查询，经 Service 获取用户；前端启动时查询，身份只存内存，不能以缓存用户资料当作认证成功。
- POST /api/v1/auth/token：外部客户端用户名密码换取 TokenPair，不创建 Session、不设置 Cookie。
- POST /api/v1/auth/refresh：仅接受有效 refresh 用途令牌；轮换刷新令牌，旧令牌不可重复使用。
- POST /api/v1/auth/logout：撤销当前认证会话/令牌族，清 Cookie；不得吞掉撤销存储故障后返回成功。全端退出不是本轮承诺。
- Authorization 存在时必须严格验证 Bearer；格式错误、过期、撤销或验证失败直接拒绝，不回退 Cookie。仅无 Authorization 时使用 Cookie。
- JWT 显式校验 HS256、issuer、exp、subject 与用途；使用唯一 jti 和令牌族标识，access 不可刷新，refresh 不可访问业务接口。注销与刷新轮换在 Redis/内存模式均可验证；Redis 轮换需原子操作，存储故障 fail closed。
- 每次认证读取当前用户状态与角色，禁用/删除立即拒绝，角色变更不继续信任签发时的旧角色。

## 二、Session、安全边界与分层

- 内存和 Redis 均实施空闲过期与绝对有效期；续期不能超过绝对期限，并同步 Cookie MaxAge/Expires。并发内存操作加锁；Redis 续期不得复活已删除会话。
- Web Cookie 生产环境强制 Secure、HttpOnly、SameSite=Lax，开发 HTTP 可显式关闭 Secure。
- Cookie 写请求及登录增加明确 CSRF 防护：允许配置的精确 Origin，拒绝不可信 Origin；无 Origin 时使用可信 Referer 或其他明确的 CSRF 校验，不能默认放行 Cookie 写请求。外部 JWT/Token 获取通道无环境 Cookie 授权；详细记录部署方式。
- CORS 来源由配置控制，与 CSRF 共享可信来源，允许凭据时不得使用通配来源。
- 登录/Token 获取增加限流（至少进程内有界实现，明确多实例局限）。
- AuthService 接口与认证契约放 internal/domain；认证 Handler 只调用 Service。认证状态存取通过 Repository 接口注入，Redis/内存实现置 repository，Service 不直接操作底层存储。仅调整本轮认证相关分层。
- 前端 api.ts 删除 Token 注入、自动刷新队列；withCredentials 保留；401 清理内存认证状态，登录失败留在表单展示错误，普通请求不无限重试。清理遗留 access_token/refresh_token/user_profile，不再写入；网络/500 错误不能伪装为认证过期。
- 更新 auth.ts、auth-context.tsx、login.tsx 及其他调用处；退出失败明确反馈，不谎称服务端已撤销。

## 三、业务码与文档

保留现有数值避免无意义破坏兼容性：定义为 HTTP 类别三位前缀 + 三位业务细分（HHHCCC），如 401001。不再宣称第二、三位是领域编号。新增码遵循现有规则并返回统一 envelope/request_id。

同步 REQUIREMENTS.md、AGENTS.md、ARCHITECTURE_AND_PLAN.md、README.md、TODOLIST.md：删除 Web localStorage/双 Token/刷新队列示例；更新端点矩阵、时序和配置；改正“XSS 物理免疫”“全端退出已实现”等无证据声明；UUID 使用 github.com/google/uuid，不称为 Go 标准库。保留技术版本，不自行升级。

## 四、验收与验证

后端测试必须覆盖：Web 登录无凭据泄露；Cookie 属性；Session 续期/空闲和绝对到期；旧 Session 替换；有效 Cookie + 无效 Bearer 拒绝；JWT 用途互换拒绝；issuer/过期拒绝；刷新重放拒绝（并发只成功一次）；注销后 access/refresh 均失效；用户禁用/删除及角色更新；恶意 Origin/缺失来源 Cookie 写请求拒绝；存储故障拒绝；请求响应含业务码与 request_id。

优先使用注入时钟、短生命周期或直接构造过期值，不用长 sleep。内存存储跑竞态测试；Redis 原子行为用可用本地 Redis 或合适测试依赖验证，未运行必须明示。

前端至少编译并验证登录、恢复身份、401、网络错误、退出失败语义；可用现有测试工具或轻量新增测试。不得把静态扫描当作浏览器交互验收。运行 backend go test ./...、相关 race 测试、frontend npm run build。依赖/工具链阻塞记录原始原因，不修改版本来绕过，也不把未执行标为通过。

## 五、后续阶段（本轮只规划）

P2：版本化迁移；SQLite/PostgreSQL 同契约测试；软删除唯一约束策略；生产种子凭据策略及全局权限 fail-closed 审查；分布式限流；全端会话撤销；权限策略跨实例一致性。

P3：CI 门禁、审计、监控、健康/就绪检查、备份恢复演练；注明负载与硬件的性能基线；有实际需求后设计租户隔离。历史 TODOLIST 的已勾选状态仅为历史记录，不视为本轮验证证据。
