# 脚手架稳定性收尾验收

日期：2026-10-24。对应 [方案](SCAFFOLD_STABILIZATION_PLAN.md) 与 [任务清单](TODOLIST.md)。本轮是隔离环境的代码验收，没有发布正式部署，也没有修改现有业务数据库。

## 结果

| 项目 | 实际验证 |
| --- | --- |
| S01 可信代理 | 单测覆盖可信/不可信代理。独立 Compose 的真实 Nginx 下，同客户端伪造不同 X-Real-IP 的前 10 次错误凭据请求均 401，第 11 次 429；另一客户端独立返回 401。发现并修复 Docker 动态分配占用 Nginx 固定 IP 的启动冲突；前后端均固定地址，网段与地址可配置。 |
| S02 配置 | YAML 默认值、环境枚举、环境变量有效期、错误配置拒绝加载定向回归通过；容器构造也校验环境/代理。 |
| S03 预览清理 | SQLite/PostgreSQL 均验证：过期正常记录和历史软删除记录物理删除，未来记录保留。 |
| S04 探针 | HTTP 回归验证正常 200、Redis 不可用 503、恢复 200、数据库关闭 503、存活仍 200；Service 阻塞探针在 1 秒预算终止。真实 Nginx 栈 Redis 停机时 health=200/ready=503，恢复 ready=200。四服务构建及启动后 healthy。 |
| S05 身份刷新 | 已登录用户在窗口激活/可见/业务 403 时后台刷新，5 秒节流并防重；网络失败保留草稿与身份；权限按钮更新，迟到响应不恢复已清理的身份。Playwright Clock 定向回归通过，真实 Cookie 退出与 401 重定向通过。 |
| S06 工程门禁 | make check / check-integration；新增前端 lint/typecheck/format；ESLint 平面配置与 TS parser 已验证兼容 ESLint 10/TS 6，新增开发依赖不改变既有依赖版本。CI 配置隔离 PG/Redis 及 Chromium。 |
| S07 真实链路 | 临时 SQLite + Vite 代理 + 本机 Chrome：登录、HttpOnly/SameSite Cookie、刷新恢复、退出、未授权页面/API 拒绝通过；独立 Compose Nginx + PostgreSQL + Redis 上同一浏览器用例通过。1280×720、390×844 截图检查无空白页、遮罩错误或横向溢出；该用例 pageerror 为空。 |
| S08 数据生命周期 | 默认已发布 Outbox 30 天，终态同步报告/幂等键 90 天；启动一次、每小时有界批次，配置可关闭。SQLite/PostgreSQL race 回归验证批次上限、pending/running/recent 保留、活跃配置引用保护、保留期内幂等查找仍返回原记录。 |
| S09 职责拆分 | LDAP 装配独立到 directory.go，诊断弹窗拥有查询/筛选，成员列静态独立，单行状态 pending 独立。接口/权限/缓存键不变；后端全量、前端完整交互与真实链路覆盖。裁剪依赖边界登记到架构文档。 |

## 执行记录

- 后端：设置独立 `INFRANEXUS_TEST_POSTGRES_DSN`（本轮 127.0.0.1:25473）与 `INFRANEXUS_TEST_REDIS_ADDR`（127.0.0.1:26473），`GOCACHE=/tmp/infranexus-go-cache go -C backend test -race -count=1 -p=1 ./...` 全量通过。日志位于 `/tmp/infranexus-stabilization-final-race.log`。随后增加的保留窗口/活跃引用断言、探针超时用例分别定向 race 通过。
- `go -C backend vet ./...`、全部 Go 文件 gofmt、`git diff --check` 通过。修正了存储工厂一个既有尾部空行，保证新门禁可执行。
- `make check-frontend`：ESLint、TypeScript、5 文件/17 项 Vitest、生产构建通过。入口 chunk 约 523 KB，原有体积警告仍存在。
- `PW_CHROME_CHANNEL=chrome npm --prefix frontend run test:e2e`：46/46 通过（约 2.6 分钟），日志 `/tmp/infranexus-e2e-final.log`；迟到身份响应追加断言后，定向用例再次通过。
- `PW_CHROME_CHANNEL=chrome npm --prefix frontend run test:integration`：真实临时后端用例通过；以 `INFRANEXUS_SMOKE_BASE_URL=http://127.0.0.1:27780` 指定本轮独立 Nginx 栈，用例同样通过。
- Docker 构建与 Compose 启动、代理客户端测试、Redis 故障恢复均实际执行。测试项目 `infranexus-stabilize`；使用临时测试变量，没有读取正式凭据。测试资源完成后回收。

## 回归中修正的测试问题

首次完整前端执行发现既有定位漂移：行中心点击可能点中“查看成员”，列设置已从 menuitem 改为具名 checkbox，批量选择文案发生变化。测试改用明确角色名称、当前 checkbox 语义；仍保留翻页清空选择、授权失败禁保存、草稿保护和冲突重试等行为断言。新增身份刷新 fixture 补齐了 UserStats 的 by_domain 字段，未放宽业务数据契约。

## 范围与限制

- Browser plugin not available，使用仓库 Playwright 与本机 Chrome；初次沙箱启动失败后，经工具审批在沙箱外完成浏览器运行。截图/trace 保存在系统临时目录，不提交测试画面或临时凭据。
- CI 工作流已编写并通过本地对应检查，未推送或触发远程 GitHub Actions；不能宣称远程流水线已运行。
- 未提供 Live AD 凭据，既有真实目录用例未覆盖；本轮没有改变目录协议。人工读屏、真实生产网关/生产规模不在此次结论内。
- 完整 mock 浏览器矩阵曾出现一次 Vite 开发环境 `ResizeObserver loop completed with undelivered notifications` 消息，未导致该用例断言失败；真实 Nginx 冒烟的 pageerror 检查为空。未屏蔽此消息，后续若可稳定复现应单独定位。
- 保留期限属于数据删除契约；有合规长期留存或更长幂等窗口要求的采用方需在启动前调整配置。批量清理不承诺到期即时释放磁盘文件空间。
