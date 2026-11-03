# M3 验收记录

日期：2026-10-28；基线 `fdde58b`，M3 为其后的工作区改动。没有新增 npm/Go 依赖或修改 UI 原子组件。

## 已取得证据

- `npm test`：8 个文件、33 项通过。新增跨页 ID 合并、排除集合、page 隔离、500 项上限、TSV 转义、公式注入及大整数保护。
- `npm run lint`、`npm run build`：通过。仍有既有入口 chunk >500 kB 提示。
- `go test -race ./internal/bootstrap -run TestUserTable -count=1`：通过。真实 SQLite HTTP 验证预检、部分冲突、新匹配不自动执行、重放不重复修改、CSV BOM/公式转义、字段拒绝、未登录/普通用户越权、系统账号保护、排除项、删除后跳过、500 项集合及 200 条操作上限。
- `go test -race ./internal/service -run TestBatchTransient -count=1`：通过。故障注入验证临时失败重试不重复成功项、执行中撤销权限阻止后续写入；这是 service 测试，不是实际数据库断网测试。
- `INFRANEXUS_TEST_POSTGRES_DSN=... go test -race ./internal/repository -run '^TestAdvancedUserQuery' -count=1`：SQLite 和真实 PostgreSQL 17.11 均通过，新增 IDs 与查询/状态范围交集断言。PostgreSQL 为临时容器，测试后已删除。此证据覆盖查询层，不等同 PostgreSQL 上的全部批量 HTTP 测试。
- M3 Chromium/Chrome mock E2E：跨页保留、全部匹配排除当前页、预检确认、部分失败和仅重试失败项通过；真实行为以后端 HTTP 测试为准。最终专项另验证查询往返不复活选择、剪贴板拒绝、当前页下载字段/范围。

日志位于 `/tmp/infranexus-m3-{unit,lint,build,api,retry,db,e2e,e2e-all,go-regression,vet}.log`，截图 `/tmp/infranexus-m3-selection.png`；临时日志/截图不作为仓库资产提交。

## 收尾与覆盖边界

全量前端 E2E 100 项通过（4.8 分钟）；相关 domain/service/handler/bootstrap 包 race 通过，bootstrap 约 181 秒；`go vet ./...` 通过。最终界面锁定改动后，M3 专项、旧 Shift 选择和分页/加载态回归 3 项通过。当前没有真实数据库故障恢复浏览器联测、原生触摸设备、Firefox/WebKit 的 M3 专项矩阵；不把故障注入或 Chrome 证据写成这些环境通过。同步导出不产生持久文件，文件归属/过期任务不适用。
