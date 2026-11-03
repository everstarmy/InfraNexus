# 后端日志专项验证记录

日期：2026-10-23；范围：本地代码与隔离测试环境，未操作正式部署。对应任务 L01–L08，操作说明见 [日志使用说明](BACKEND_LOGGING.md)。

## 验收结论

全量 race 测试退出码 0：200 项测试事件通过（含子用例，137 个顶层测试），3 项 Live AD 测试跳过，0 失败；9 个含测试包通过，其他包无测试。go vet、go mod tidy、Docker 构建与隔离容器冒烟通过。SQLite/PostgreSQL 日志专项用例及真实 Redis 回归均已执行。结构化环境与镜像证据见 [JSON](evidence/backend-logging-2026-10-23.json)。

各任务通过上述正式回归与对应代码变更验收，提交关联以 Git 历史为准。测试专用容器/卷已清理，历史 local 镜像和现有项目数据保持原状。

## 实施内容

- 配置：环境变量 > YAML > 兼容缺省；日志与 SQL 级别独立，显式 false/0 保留，非法配置拒绝启动。
- Context：统一 requestmeta，Context Handler 自动提取请求/任务/操作人，派生 logger 分组与并发隔离，重复 JSON 键合并。
- HTTP：官方 requestid 中间件前限制外部 ID 长度，官方读取、标准 Context、响应头一致；panic/CORS 提前返回纳入汇总；不记录原始 URL/query。
- SQL：外层 ParamsFilter、独立级别与慢阈值、惰性回调、安全数据库错误码、绑定参数与驱动详情保护。
- Service：auth 非致命错误关联；LDAP 任务恢复来源；后台 worker/tick 独立 task_id；SSE 独立流 Context 与关闭事件。
- 输出：stdout/file/both、app/access 与 SQL 分文件、轮转/压缩/保留、权限、16KiB 上限、限频故障诊断、正常和失败退出资源关闭。
- 部署：Compose local logging 20m×5；日志消费字段和操作文档同步。

## 环境与命令

执行环境：macOS arm64、Go 1.27.2、Docker Engine 29.3.1；隔离 PostgreSQL 17.11（alpine3.23）、Redis 8；SQLite 使用临时目录。测试 PostgreSQL/Redis 容器分别为 infranexus-logging-test-pg、infranexus-logging-test-redis，通过临时 loopback 端口提供；环境变量分别为 INFRANEXUS_TEST_POSTGRES_DSN、INFRANEXUS_TEST_REDIS_ADDR，不使用真实部署凭据。

实际命令（环境变量在命令执行时指向上述隔离实例）：

```sh
go -C backend mod tidy
GOCACHE=/private/tmp/infranexus-logging-go-cache go -C backend vet ./...
GOCACHE=/private/tmp/infranexus-logging-go-cache go -C backend test -race -p 1 -json ./... -count=1
BUILDX_CONFIG=/private/tmp/infranexus-logging-buildx docker build -f backend/Dockerfile -t infranexus/backend:logging-test .
docker compose -p infranexus-logging-smoke --env-file /private/tmp/infranexus-logging-smoke/smoke.env -f compose.yaml -f /private/tmp/infranexus-logging-smoke/override.yaml up -d --wait --no-build
```

Go build cache 和 Buildx activity 目录切换到临时目录以满足写入边界；go mod tidy 通过缓存写入授权后完成。验证 stdout/文件故障时只使用临时目录和注入 Writer，没有耗尽磁盘。仅测试项目清理其自身容器/卷。

## 正式回归覆盖

| 回归 | 断言 |
| --- | --- |
| TestLoggingDefaultsAndEnvironment / TestLoggingYAMLAndInvalidValues | 环境变量独立绑定、兼容 debug、生产缺省 JSON、false/0、YAML 和非法值 |
| TestContextGroupsAndConcurrency | 24 个并发请求隔离；task/operator 与请求一致；WithGroup/WithAttrs、无来源不伪造 |
| TestIndependentLevelsAndBoundedEvent | app=error 时 sql=info 仍输出；超限保留关联字段与合法 JSON |
| TestGORMModesAndLazySQL / TestGORMDisabledAndLiteralSQL | 各级别、NotFound、慢查询、LogMode 副本、禁用、惰性回调与字面值省略 |
| TestHTTPServiceSQLCorrelation/sqlite、postgres | 真实 AuthHandler→AuthService→Repository/GORM；8 并发登录辅助操作失败仍成功，三流 ID 一致；真实失败 SQL→HTTP 500002；404/401/403/409/500/panic/CORS/超长 ID；官方与标准 Context ID 一致；参数、驱动、密码哈希与 panic 哨兵不泄露 |
| TestOutputFailureTriesOtherDestinations / TestInitializationFailureAndStdoutNoDirectory | 一个输出失败继续写另一个；诊断限频且不泄露原始错误；stdout 无目录副作用，文件初始化失败 |
| TestFileRoutingRotationAndPermissions / TestBackupCountAndAgeCleanup | app/sql 分流、1MiB 触发实际轮转、压缩完整性、0640、备份数和年龄清理、重复关闭 |
| TestSafeAttributes | 显式敏感字段和原始 error 保护、UTF-8 截断 |
| TestLDAPTaskRestoresPersistedLogCorrelation | 任务从持久化来源恢复 Context；数据库操作与终态日志携带相同字段；无请求来源不伪造 |
| 既有后端完整矩阵 | 授权/事务、双数据库、真实 Redis、LDAP 业务状态、SSE 停机等回归 |

## Docker 实测

使用独立 Compose 项目 infranexus-logging-smoke，未覆盖现有 local 镜像标签。前端沿用现有镜像，后端使用新 logging-test 镜像，全部四服务健康。实际检查 app HostConfig.LogConfig 为 local、max-size=20m、max-file=5；应用 stdout 每行均可 JSON 解析，没有 Fiber banner。

通过 Nginx 访问 health 返回 200，带敏感哨兵的错误登录返回 401；响应 X-Request-ID、access/sql 关联一致，哨兵不进入 stdout/stderr。SIGTERM 后出现 app.stopped。

单独以非 root UID 10001 容器运行 both 模式，目录为 /app/data/logs：目录 0750、活动文件 0640；实际生成 11 条应用事件、279 条 SQL 事件（该次数对应首次文件冒烟，查询次数不是稳定接口）。两个文件分类正确，stdout 总数等于两文件之和，最后的 app.stopped 已写入 app.log。不可写 /root/unwritable 目录时退出码 1，stderr 为 stage=logging 的安全 JSON 诊断。

## 兼容与未覆盖范围

### 正常空轮询 SQL 降噪增量（2026-10-23）

反馈为默认开发配置下，无用户操作也每 500ms 打印授权 Outbox 空查询。正式回归 `TestAuthorizationWorkerIdleSQLLogging` 在真实 Service→Repository/GORM 链路连续执行三个空轮询，修复前复现三条 SQL，修复后无输出；SQLite/PostgreSQL 均执行。查到工作时仍发布和更新，普通请求空查询及数据库失败均保留日志。

`TestGORMEmptyPollFiltering` 覆盖标记空轮询、普通空查询、带 request_id 的查询、非空结果、未知行数、慢查询、错误和 NotFound。默认配置进程冒烟未设置任何 logging 环境变量，空闲观察 2 秒未出现空轮询 SQL，正常启动 SQL 与 app.stopped 仍可见。该改动不改变轮询频率或日志参数。增量全量 race：212 项测试事件通过（含子用例），0 失败，3 项既有 Live AD 因无凭据跳过；vet 通过，隔离 SQLite/PostgreSQL/Redis 回归均执行。新证据见 [空轮询验证](evidence/backend-idle-sql-2026-10-23.json)。

### 既有范围说明

无数据库 schema 变更、无 API/前端业务字段迁移。日志消费方需适配 duration_ms 数值字段、route 路由模板、category/event、安全错误分类；旧 latency/path/trace 嵌套结构不继续保证。默认仍为 stdout；文件模式可改回 stdout 后重启。

三项既有 Live AD 测试因本轮未注入真实目录凭据而跳过：TestLiveADRootDSEAndPagingReadOnly、TestLiveADGatewayReadOnly、TestLiveADIsolatedApplicationLifecycle。本轮日志专项的 SQLite/PostgreSQL/Redis 测试不允许以 Skip 代替通过；未重做真实企业目录验收，也未配置集中采集和生产磁盘配额。L05 的来源恢复采用已持久化任务快照的正式回归，无新增进程崩溃恢复协议。

SQL 正文省略是保守策略，不是任意 SQL 方言脱敏保证；Raw/Exec 必须继续绑定参数。轮转清理/压缩由依赖库异步维护触发，Close 不承诺等待所有历史压缩完成；容器日志容量策略不保证固定保留天数。运行日志不承担完整业务审计。
