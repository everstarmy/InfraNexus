# 后端日志实施方案

日期：2026-10-23。状态：功能已实施，验收记录见 [日志专项验证](BACKEND_LOGGING_VALIDATION.md)。操作说明见 [日志使用说明](BACKEND_LOGGING.md)，任务入口见 [TODOLIST](TODOLIST.md)。

## 1. 目标与范围

统一应用、HTTP 访问和 GORM SQL 日志的字段、请求关联、级别、输出位置与脱敏策略。让 Service 中的 `WarnContext/ErrorContext` 自动关联请求，支持 Docker 标准输出和直接部署的滚动文件。保证现有 HTTP 状态码、业务码和认证流程不因日志改造改变。

本轮不新增日志查询页面、集中采集平台或完整业务审计系统。LDAP 已有持久化同步报告继续保留；运行日志不替代数据库任务状态。PostgreSQL 服务端日志、SQLite WAL/journal 也不属于 GORM 操作日志，不承担“谁修改了什么”的审计职责。

## 2. 实施前代码现状与问题（保留设计依据）

| 位置 | 当前行为 | 本轮处理 |
| --- | --- | --- |
| `backend/internal/core/logger/logger.go` | debug 控制 Text/JSON、级别和源码位置；只写 stdout | 输出、格式、级别独立配置；提供受管理的日志生命周期 |
| 同上 `WithContext` | 读取自定义 `logger.RequestIDKey` | 与 `requestmeta` 的私有键不一致，修复并统一读取入口 |
| `backend/internal/middleware/request_log.go` | `requestid.FromContext(c)` → `requestmeta.WithRequestID(c.Context(), id)` | 保留官方读取方式和标准 Context 桥接；补安全复制及全链路测试 |
| Service 中 `WarnContext/ErrorContext` | 使用注入的标准 slog logger | 标准 Handler 不自动读取 Context 值，增加 Context Handler |
| `backend/internal/bootstrap/database.go` | 请求感知 GORM wrapper，200ms 慢阈值，debug 决定全部 SQL 或慢/错 SQL | SQL 独立配置；核心适配器移入 core，去掉对 middleware 的依赖 |
| 同上 GORM wrapper | 设置 `ParameterizedQueries=true`，但外层没有实现 `ParamsFilter` | 当前 GORM callbacks 对外层断言接口，存在参数过滤失效路径，必须修复 |
| GORM slog 适配器 | 输出 `err.Error()` | 驱动错误可能携带字段值，改为安全错误分类 |
| `backend/internal/bootstrap/fiber.go` | recover 在请求日志外层，CORS 在请求日志之前 | panic 和提前返回存在覆盖缺口，调整顺序并回归 |
| `compose.yaml` | 无显式 logging 轮转配置 | 给服务设置有界轮转；通过 Docker 工具读取 |

核对版本：Fiber v3.6.1、GORM v1.31.2。Fiber 当前版本的 `requestid.FromContext` 接受 `fiber.Ctx` 和标准 `context.Context` 等类型；此前讨论不能理解成“官方接口只能接受 fiber.Ctx”。本项目继续在 HTTP 边界读取，再桥接到 `requestmeta`，目的是让 Service、Repository 和核心 logger 不依赖 Fiber，并明确后台任务的元数据所有权。

## 3. 日志分类和字段契约

| category | 事件 | 默认文件 |
| --- | --- | --- |
| `app` | 启停、业务运行、后台任务、降级与异常 | `app.log` |
| `access` | 一次 HTTP 请求的汇总结果 | `app.log` |
| `sql` | GORM 执行错误、慢 SQL、可选普通 SQL | `sql.log` |

共同字段：`time`（UTC RFC3339，可含小数）、`level`、`msg`、`app`、`env`、`category`、`component`、`event`。生产 JSON 一条事件一行；开发 text 保留相同语义。`event` 使用稳定英文编码，`msg` 面向阅读，不用动态业务值拼接消息。

关联字段按实际存在输出：`request_id`、`task_id`、`operator_id`；不伪造无来源的请求 ID。请求 ID 是关联标识，不能作为认证或授权凭证。共享 logger 不保存当前用户或请求状态。

访问日志追加：`method`、`route`（匹配成功时的路由模板）、`status`、`duration_ms`、`ip`、错误时的 `business_code` 和安全错误分类。耗时统一为数值毫秒，避免 slog Duration 与 GORM 字符串耗时单位不一致。未知路由使用安全占位，默认不记录原始 URL/query，避免路径参数和查询凭据泄露。

SQL 日志追加：`db_driver`、`duration_ms`、`rows`（未知时省略）、`sql`（参数化模板且长度受限）、`slow`、`error_type`、可安全提取的 `db_code`。不记录 SQL 参数、连接串或原始驱动 error/detail/hint。SQL 不解析成业务审计事件。

2026-10-23 空轮询降噪增量：授权 worker 仅为 Outbox Pending SELECT 派生带 `requestmeta.WithSQLPoll` 标记的 Context。SQL info 级别仅省略无请求来源、无错误、非慢且 rows=0 的这类查询；正常请求空结果、未知行数、查到工作、慢查询与错误仍保留。标记不传播到后续发布/更新操作，轮询频率和配置不变。

## 4. 请求与任务关联

### 4.1 HTTP 边界

目标中间件顺序：`requestid → RequestLogger（桥接 Context）→ recover → responsetime → CORS → 认证/鉴权/业务路由`。recover 在请求汇总内侧，保证下游 panic 转换成错误后，请求日志仍能记录；全局 ErrorHandler 继续负责响应格式。入口 ID/日志组件自身故障不能靠此顺序宣称已全部覆盖。

RequestLogger 用 `requestid.FromContext(c)` 获取官方 ID，使用 `strings.Clone` 复制后写入 `requestmeta.WithRequestID`，再 `c.SetContext`。保留中间件已放入标准 Context 的其他字段和取消语义。按当前官方的可见 ASCII 校验基础，额外限制关联 ID 长度为 128 字节；超长请求头在官方 requestid 中间件执行前移除，由官方生成新 ID；官方 FromContext(c)、响应头和标准 Context 保持一致，禁止截断后误关联。

Handler 只传 `c.Context()`；Service 各方法首参为 `context.Context`；Repository 所有查询、预加载、事务和重试均沿用此 Context。检查替换成 `context.Background()`、异步捕获 fiber.Ctx 和 transaction Context 丢失元数据等路径。

### 4.2 自动提取的 Context Handler

采用一个 `slog.Handler` 包装器，`Handle(ctx, record)` 从 `requestmeta` 读取关联字段，添加到记录后委托分类输出 Handler。普通 Service 调用 `s.logger.WarnContext(ctx, ...)` 即可关联。`Warn/Error` 没有传入 ctx 的地方，改用 Context 版本；启停事件可使用生命周期 Context。

- `Enabled`、`WithAttrs`、`WithGroup` 完整委托，派生 logger 必须保留包装能力；分类级别由输出路由按 category 判断，不能先用 app 级别过滤 SQL。
- Clone Record 后添加字段，不修改共享状态；来自 Context 的关联字段统一放在顶层，不受业务 `WithGroup` 影响。
- `request_id/task_id/operator_id` 为保留字段，业务不得随意覆盖；兼容旧显式字段时保证最终每个顶层键只有一个值，Context 有值时优先，无值时保留已明确传入的安全关联值。
- 统一使用 `requestmeta.RequestID(ctx)`，删除旧键或在确认全部调用方迁移后移除；保留旧 `logger.WithContext(ctx)` 时让它使用同一入口且不制造重复字段。
- 日志注入保持现有 `*slog.Logger` 形式，测试可注入 Buffer；不把带某次请求信息的 logger 赋回 `s.logger`。

### 4.3 后台任务与 SSE

后台任务从应用生命周期 Context 派生，在任务边界写入 task_id；用户触发的异步 LDAP 任务复制已持久化的 request_id/operator_id，通过 `requestmeta` 注入任务 Context。定时任务只有 task_id，不虚构 HTTP 请求；重启恢复任务仍从持久化记录恢复来源字段，不新增 schema。

不持有或跨 goroutine 使用 fiber.Ctx，不直接延用短 HTTP 请求的取消生命周期。SSE 沿用现有生命周期和连接管理，显式复制连接的请求 ID 到独立 Context；不改变断线、撤权及停机语义。访问汇总中的耗时仅代表 Handler 阶段，SSE 实际流关闭使用单独 app 事件，不冒充完整连接耗时。

## 5. Service 错误记录约定

| 分支 | 记录责任 | 级别 |
| --- | --- | --- |
| 参数错误、资源不存在、业务冲突 | 返回领域错误；访问层记录结果 | 沿用访问层 4xx Warn，不额外 Error |
| Repository 错误导致本次请求失败 | Service 补操作语义并保留错误链；访问层记录业务失败 | 访问层 5xx Error；SQL 层可另有执行失败事件 |
| 错误被消化，主流程继续 | Service 当场记录操作、目标 ID、安全错误类型 | Warn |
| 有界重试中间失败 | 不逐次输出 Error；需要时 Debug + attempt | Debug |
| 后台任务最终失败 | 任务执行边界汇总一次 | Error |
| 正常取消、主动断开、预期资源不存在 | 按实际语义归类，不统一当系统故障 | Debug/Info 或省略 |

“避免重复”针对相同业务错误逐层打印：SQL 执行事件与 HTTP 请求结果可以同时存在，通过 request_id 关联。若 Service 才掌握关键业务失败信息，允许独立事件，但应表达该信息而非复制 err 文本。

目标用法（实施后生效）：

```go
if err := s.users.UpdateColumns(ctx, user.ID, updates); err != nil {
    s.logger.WarnContext(ctx, "Update last login timestamp failed",
        "component", "auth_service",
        "event", "auth.last_login_update_failed",
        "operation", "update_last_login",
        "user_id", user.ID,
        "error_type", fmt.Sprintf("%T", err),
    )
    // 辅助操作失败，主登录流程继续；request_id 由 Handler 注入。
}
```

此示例对应项目已有的非致命更新时间操作。其他方法若本来应返回错误，不能为了记录日志而吞错。原始 `error` 不默认加入日志；非数据库异常同样可能包含 LDAP 凭据、URL 等敏感内容，应使用已审核的安全摘要。

## 6. SQL 适配器与脱敏

在 `internal/core/logger` 新建 GORM 适配器，实现 `gormlogger.Interface` 和 `ParamsFilter`，并添加编译期接口断言。bootstrap 只做配置和注入，不再从 middleware 获取元数据。SQL 使用独立 category 和级别路由。

`Trace` 先判断 Silent/级别/错误/耗时，仅在确实需要输出时执行惰性 SQL 回调。Warn 默认记录错误及超过 200ms 的 SQL；Info 增加普通 SQL；Error 仅错误；Silent 不记录。LogMode 返回独立副本；全局 SQL 禁用是硬开关，业务 `.Debug()` 不能绕过。忽略 ErrRecordNotFound 的错误分支，不妨碍其作为慢 SQL 被记录。

参数保护默认始终启用，不提供生产参数明文开关。实现 `ParamsFilter` 只能阻止绑定变量展开，不能清理已经拼进 Raw/Exec/表达式的字面值。必须同时清查动态拼接 SQL，统一绑定参数；无法确认安全的 SQL 路径省略正文，仅输出安全元数据，禁止用简单正则承诺通用 SQL 脱敏。限制模板长度（默认 4096 字节），截断需保持 UTF-8；截断不是脱敏措施。

错误字段使用安全分类、驱动类型、SQLSTATE/SQLite 数字码等，不输出 PG detail、冲突键值、sqlite 原始消息及原始 DSN。HTTP cause、LDAP 错误和业务后台日志复用同一安全错误约定。验证必须往真实查询参数与驱动错误填入敏感哨兵值，断言所有输出均不包含。

## 7. 配置设计与环境默认值

已新增 `logging`，下列完整配置受支持；config.yaml 只显式列出部分字段，其他字段按环境缺省：

```yaml
logging:
  format: json                 # text | json；缺省由 app.debug 决定
  output: stdout               # stdout | file | both
  level: info                  # debug | info | warn | error；应用/访问日志
  add_source: false
  file:
    directory: ./logs
    max_size_mb: 100            # 每个活动文件的轮转阈值
    max_backups: 10             # 每类日志保留的备份文件数
    max_age_days: 14
    compress: true
  sql:
    enabled: true
    level: warn                # silent | error | warn | info，独立于应用级别
    slow_threshold_ms: 200
    max_sql_length: 4096
```

| 场景 | 缺省策略 | 实际位置 |
| --- | --- | --- |
| 本地开发（debug=true） | text、app debug、SQL info、stdout | 当前终端，不自动生成文件 |
| 非 debug / Docker | JSON、app info、SQL warn、stdout | Docker 日志驱动管理，通过 `docker compose logs` 读取 |
| 二进制文件部署 | 显式启用 file 或 both | 建议 `/var/log/infranexus/app.log` 和 `sql.log` |
| 本地需要留存 | 显式启用 file 或 both | 若在 backend 下启动且目录为 ./logs，则位于 backend/logs/ |

优先级：显式环境变量 > YAML > 兼容默认值。缺少整个 logging 块时保留现有 debug 行为，显式 logging 字段优先于 app.debug；production 缺省 JSON。需要区分布尔 false 和未配置，使用指针或 Viper IsSet，不能靠零值猜测。`APP_LOGGING_OUTPUT`、`APP_LOGGING_LEVEL`、`APP_LOGGING_SQL_LEVEL` 等即使没有对应 YAML 键也必须能 Unmarshal，通过默认值/显式绑定保证，并测试。

非法格式、输出模式、级别、非正大小/保留值/SQL 长度、负慢阈值在启动时拒绝。慢阈值为 0 明确定义为禁用慢查询事件（错误与 Info SQL 仍按级别记录）。日志相对目录以进程工作目录为基准，启动输出解析后的绝对路径；stdout 模式不创建日志目录。

## 8. 输出、轮转与生命周期

应用和访问日志共用 app.log，SQL 只进 sql.log；both 模式同时写 stdout 和对应文件，不把 SQL 再写入 app.log。每类输出独立级别；例如 app=error、sql=info 时普通 SQL 仍应输出。

文件轮转采用已核查接口与 MIT 许可证的 lumberjack v2.2.1，版本已锁定；不自研跨平台轮转。按大小轮转，备份数量与年龄同时约束，压缩旧文件。单进程独占目录，多实例使用各自目录或 stdout，不让多个进程共享同一活动文件。100MB ×（1 个活动文件 + 10 个备份）× 2 类约为 2.2GB 的未压缩名义预算；压缩临时文件和单条超大日志有额外开销，不能宣称硬磁盘配额。单条事件建议上限 16KiB，字段序列化前限长、按 schema 保留关联信息，禁止直接截断 JSON 行。

轮转只由一方负责：应用文件模式使用应用轮转，不再叠加 logrotate；stdout 模式由平台负责。目录默认 0750、文件 0640；直接部署时由运维预置所有者，Docker 文件挂载如启用须允许 UID 10001 写入。

初期同步写入，不引入异步丢弃队列。文件初始化失败时输出不含秘密的 stderr 诊断并终止启动；运行中写入失败时，以限频、非递归的 stderr 诊断降级，不使业务处理 panic。both 模式一个输出失败不能阻止另一个输出尝试写入；恢复行为和丢失风险需要操作文档说明，运行日志不提供审计级交付保证。

logger 初始化返回受管理资源和错误，明确关闭责任。正常停机顺序：停止接入/取消后台任务 → 等待退出 → 关闭业务资源 → 输出最终停机事件 → 关闭日志输出。梳理 main 中 os.Exit 绕过 defer 的路径，通过 run 返回错误、顶层统一退出等方式保证可关闭，stdout/stderr 不由 logger 关闭。配置加载早于日志初始化，其失败使用最小化 stderr 启动诊断，不输出完整配置。

Docker Compose 为 app/frontend/postgres/redis 设置 `local` logging，初始 `max-size: 20m`、`max-file: 5`；这是每容器容量策略，不等于保留 14 天。应用不依赖 Docker 私有日志路径，使用 `docker compose logs --since ... app`；长期保留由未来采集平台负责。避免把开发 text/ANSI 或 Fiber banner 混入生产 JSON 流，需要核查启动输出。

## 9. 模块变更边界

| 模块/文件 | 计划变更 |
| --- | --- |
| `core/requestmeta` | 唯一请求 ID 访问入口；扩展 task/operator 元数据 |
| `core/logger` | 初始化、Context Handler、分类路由、安全字段、滚动输出、GORM 适配器 |
| `config/config.go`、`config.yaml` | 日志结构、默认值、环境变量绑定和校验 |
| `middleware/request_log.go`、`bootstrap/fiber.go` | HTTP 桥接、覆盖顺序、访问汇总 |
| `bootstrap/database.go` | 注入 SQL logger，保留数据库初始化职责 |
| `service`、SSE handler | 既有日志迁移、错误处理责任、任务关联；按需注入 logger |
| `cmd/server/main.go`、`bootstrap/app.go` | 日志关闭和启动失败流程 |
| `compose.yaml`、`.env.example`、`.gitignore` | 部署参数、轮转、忽略 logs 目录及 .log.gz 等备份 |
| `docs/DOCKER.md`、架构/需求文档 | 使用说明、字段兼容变更及验证证据 |

## 10. 验证与发布门禁

1. Context Handler：请求/任务字段、空 Context 值、派生 logger、WithGroup、重复字段、并发隔离；`-race` 通过。普通 `Warn` 不假装携带请求信息。
2. 请求链路：真实 Fiber 测试请求 → Handler → Service → SQLite/PostgreSQL GORM，访问/app/sql 三类 request_id 与响应头一致；失败响应正文 ID 同样一致。并发不同 ID 不串号；生成 ID、合法透传、超长重建、404/401/403/409/500、panic、CORS 提前返回覆盖。
3. 非致命失败：Service 记录 Warn，HTTP 保持原本成功；致命失败按原业务码返回，访问汇总仅一条。事务和重试保留 ctx。
4. SQL：普通/慢/错误/NotFound、Silent/Error/Warn/Info、LogMode 副本、禁用、惰性回调与独立 app/sql 级别矩阵。SQL、错误、两类文件/stdout 中均无敏感哨兵值；检查 Raw/Exec 字面值风险。
5. 文件：临时目录测试分类分流、JSON 合法性、大小轮转、备份数、过期清理、压缩、权限、关闭、初始化失败；使用可注入故障 Writer 验证运行失败与 both 输出，不通过耗尽真实磁盘制造故障。
6. 生命周期：后台任务停止、日志最后一条可见；LDAP 来源关联/定时无请求来源、SSE 关闭与停机回归；中途退出资源释放。
7. Docker：隔离 Compose 冒烟，核对 logging 配置、JSON、logs 查询、重建后的容量策略和权限；不承诺容器删除后历史日志仍可用。记录运行环境和采集限制。

实施阶段先跑目标包，全部改造完成后在 backend 执行 `go test -race ./...` 与 `go vet ./...`。PostgreSQL/Redis 使用隔离测试实例，沿用仓库测试变量和启动方式，不引用真实部署凭据。仅有 SQLite 或 mock 通过不能标记双数据库通过；Skip 必须登记。实施验收结果、实际命令、跳过项和部署限制登记在专项验证文档，不把缺环境的用例标成通过。

## 11. 实施顺序与回退

顺序：L01 字段/配置 → L02 Context → L03 HTTP → L04 SQL → L05 Service/任务 → L06 文件/生命周期 → L07 部署 → L08 集成验收/文档。L04/L05 可在 L02/L03 稳定后分别实施，不要求并行代理。每项具体勾选标准见 TODOLIST。

现有业务 API 与数据库 schema 无迁移；JSON 耗时、SQL 字段和 category 属于日志消费契约变化，发布说明需注明。默认 stdout；文件故障可通过 logging.output=stdout 并重启回退。配置开关不能恢复已经丢失的日志；旧版本回滚可能重新暴露旧脱敏缺陷，应优先回退输出方式并保留安全修复。新增依赖与代码改动按功能提交，旧版本程序对新字段的实际兼容行为以配置测试为准。

## 12. 官方参考与证据边界

- [Fiber v3 RequestID](https://docs.gofiber.io/next/middleware/requestid/)：官方读取接口、多种 Context 类型、请求缓冲区字符串生命周期。
- [Go slog](https://pkg.go.dev/log/slog)：Context 日志和 Handler 扩展接口；字段提取属于本项目包装器职责。
- [GORM Logger](https://gorm.io/docs/logger.html)：级别、慢查询、参数化与 Context 接口。ParamsFilter 缺口另以本地锁定 v1.31.2 的 callbacks.go/logger/slog.go 核实。
- [Docker logging](https://docs.docker.com/engine/logging/configure/)：标准输出采集、local 驱动和轮转；项目容量参数为本方案建议值。

在线文档可能先于项目版本演进，最终以 go.mod 锁定源码和正式回归为准。
