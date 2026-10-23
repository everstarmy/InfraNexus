# 后端日志使用说明

2026-10-23 日志专项实施后的运行契约。设计背景见 [方案](BACKEND_LOGGING_PLAN.md)，任务与验收见 [TODOLIST](TODOLIST.md)。

## 记录方式与位置

业务日志统一使用注入的 `*slog.Logger`。应用与 HTTP 访问事件共用应用流，GORM 使用独立 SQL 流。

| 场景 | 应用与访问日志 | SQL 日志 |
| --- | --- | --- |
| 默认本地运行 | stdout；debug 时为 text | 同一 stdout，category=sql |
| Compose 部署 | JSON stdout，category=app/access | JSON stdout，category=sql |
| logging.output=file | `<directory>/app.log` | `<directory>/sql.log` |
| logging.output=both | stdout 与 app.log | stdout 与 sql.log |

相对 directory 按**进程工作目录**解析。从 backend 运行时 `./logs` 对应 backend/logs，从仓库根目录启动则对应根目录 logs。文件模式启动打印绝对目录；stdout 模式不创建目录。直接部署建议 `/var/log/infranexus`，提前赋予服务用户权限。

新建目录模式 0750，活动文件 0640。一个目录只允许一个进程写入，多实例各自配置目录。路径不可写在启动时退出；配置与日志初始化错误的安全 stderr 事件标记 `stage=configuration/logging`。

## 配置

```yaml
logging:
  format: json                 # text | json
  output: stdout               # stdout | file | both
  level: info                  # debug | info | warn | error
  add_source: false
  file:
    directory: ./logs
    max_size_mb: 100
    max_backups: 10
    max_age_days: 14
    compress: true
  sql:
    enabled: true
    level: warn                # silent | error | warn | info
    slow_threshold_ms: 200
    max_sql_length: 4096        # 1..4096 字节；UTF-8 安全截断，可附省略号
```

未显式配置 format/level/add_source/sql.level 时沿用 debug 默认：开发 debug=true 为 text/debug/源码位置/全部 SQL；debug=false 为 JSON/info/无源码位置/慢与错误 SQL。production 缺省格式总是 JSON。环境变量优先于 YAML，显式 false 与 0 不会被缺省覆盖；旧配置不必新增 logging 块。

所有叶子字段支持 `APP_LOGGING_...` 环境变量，即使 YAML 中未定义该键。例如从仓库根目录：

```sh
APP_LOGGING_LEVEL=info APP_LOGGING_SQL_LEVEL=warn go -C backend run ./cmd/server
APP_LOGGING_OUTPUT=file APP_LOGGING_FILE_DIRECTORY=./logs go -C backend run ./cmd/server
```

`go -C backend` 先切换到 backend，第二个示例目录位于 backend/logs。应用和 SQL 级别独立；SQL warn 记录错误和超过阈值的查询，info 增加普通查询，error 仅错误，silent 或 enabled=false 关闭。slow_threshold_ms=0 只关闭慢查询事件。SQL enabled=false 不能被 `.Debug()` 绕过；排障应修改 SQL 配置并重启。文件大小、备份数和天数必须大于 0，非法值在启动时拒绝。

SQL info 级别也会自动过滤授权 Outbox 后台轮询的正常空结果，无需改配置。只有该轮询 SELECT 的派生 Context 带标记，且无 request_id、无错误、未超过慢查询阈值、rows=0 时才省略；查到工作、行数未知、慢查询、错误以及普通请求的空查询均保留。此策略仅减少输出，不停止轮询，不改变授权通知或数据库执行。

## Service 中如何记录错误

HTTP 边界使用 `requestid.FromContext(c)`，复制 ID 并桥接到标准 Context；Handler 传 `c.Context()`，后续各层继续传 ctx。运行时 Context Handler 自动添加 request_id：

```go
if err := s.users.UpdateColumns(ctx, user.ID, updates); err != nil {
    s.logger.WarnContext(ctx, "Update last login timestamp failed",
        "event", "auth.last_login_update_failed",
        "operation", "update_last_login",
        "user_id", user.ID,
        "error_type", fmt.Sprintf("%T", err),
    )
}
```

只有传 Context 的方法才能自动关联。普通 Warn/Error 用于没有请求的初始化等场景；不要把请求 logger 保存到共享 Service 字段，也不要用 context.Background() 丢弃调用方元数据。

错误继续返回并导致请求失败时，通常由访问层记录，Service 保留错误链与操作语义；被消化的非致命错误必须在 Service 记录 Warn。后台任务最终失败记录 Error，重试中间状态不重复输出 Error。SQL 执行失败和 HTTP 失败是不同事件，允许通过同一 ID 关联。

默认不输出原始 error 文本；`logger.SafeError(err)` 可生成类型与安全数据库码。额外诊断应使用稳定 event/operation/经审核的安全摘要，不得把整个请求、配置、Cookie、密码或 Token 放进 message。

## 字段与关联

- 共同字段：time（UTC）、level、msg、app、env、category、component、event。
- 来源字段：request_id、task_id、operator_id；无来源不伪造请求 ID。这些字段不代表授权。
- 访问字段：method、route（路由模板）、status、duration_ms、ip，错误时 business_code 和错误分类；不记录原始 URL/query/请求体。
- SQL 字段：db_driver、duration_ms、rows（已知时）、slow、sql 或 sql_omitted、安全错误类型及可提取的 db_code。

关联字段始终位于顶层，Context 有值时优先，WithGroup 不会隐藏关联字段。同一对象内重复键合并，避免采集器解释不一致。单条事件最大 16KiB；超限时保留基本关联信息并标记 truncated=true，不截断 JSON 行。

LDAP 任务从持久化记录恢复 request_id/operator_id，使用任务自己的生命周期；定时同步使用 task_id，无 HTTP 来源。权限收敛 worker 和调度 tick 有独立 task_id。SSE 独立流 Context 使用复制后的请求 ID，关闭事件为 sse.closed；HTTP 汇总耗时只代表 Handler 阶段。

## SQL 保护的边界

GORM 适配器直接实现 ParamsFilter，阻止绑定值展开；查询必须使用占位符。检测到字面值/注释等风险特征时省略 SQL 正文，只留元数据。该保守检查不是通用 SQL 脱敏解析器；Raw/Exec/表达式禁止拼入用户输入，不能依赖正则处理任意方言或动态 SQL。当前生产 Repository 的 Exec 均使用固定模板与绑定参数。

启动迁移/建表 SQL 也可能省略；rows=-1 时省略影响行数。ErrRecordNotFound 不作为执行错误，但可记录为慢查询或 info 事件。运行日志不替代业务审计、数据库服务端诊断或 LDAP 持久化报告。

## 轮转、故障与停机

文件轮转使用 MIT 许可的 lumberjack v2.2.1，按大小轮转，备份数/年龄共同约束并压缩。清理与压缩由依赖库后台维护触发，不承诺进程退出瞬间全部完成；活动日志采用同步写入，不设置应用级异步消息队列。不要再叠加 logrotate。

默认两个流未压缩的名义预算约 2.2GB，临时压缩等可能有额外开销，不是硬磁盘配额。运行中输出失败会每分钟最多输出一次安全 stderr 诊断；both 模式继续尝试另一个输出。后续写入可恢复，丢失记录不会补回。运行日志不提供审计级交付保证。

停机先停止 HTTP/后台任务并关闭业务资源，记录 app.stopped 或 app.stopped_failed，再关闭文件。初始化失败退出，stderr 不输出驱动/配置原始错误。修改 logging.output=stdout 并重启可回退文件模式，不能恢复丢失日志。

## Docker 查询与保留

Compose 四服务显式使用 local 驱动，每容器 20m×5 策略。应用级别使用 `.env` 的 LOG_LEVEL、SQL_LOG_LEVEL；stdout 固定 JSON，Fiber banner 已关闭。

```sh
docker compose logs --since 30m app
docker compose logs -f app
```

不要直接读取 Docker 内部文件。容量策略不等于保留 14 天，也不能保证容器删除后的历史留存；长期保留需要集中采集。显式启用文件挂载时须允许容器 UID 10001 写入；默认 Compose 不挂载应用日志文件。
