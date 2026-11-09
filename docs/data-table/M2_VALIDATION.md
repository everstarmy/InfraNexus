# M2 验收记录

当前数据库支持范围为 PostgreSQL。下文涉及旧版文件数据库的结果是当时的验收记录。

日期：2026-10-28。源码基点仍为 `e7046d08fb49ac9ff82f90f59efd80f4315c6e03`，M0/M1/M2 工作区改动尚未提交。实际接口见 [M2 接入说明](M2_IMPLEMENTATION.md)。

## 结果

| 检查 | 实际结果 |
| --- | --- |
| 前端 lint | 通过 |
| 前端单元 | 7 个文件、27 项通过，新增查询/URL/偏好/视图格式测试 |
| TypeScript | 生产及表格夹具、页面 E2E、集成测试类型检查通过 |
| 生产构建 | 通过；保留 Vite 入口 chunk >500kB 提示，没有开展无关分包优化 |
| 完整 mock E2E | 99 项通过，耗时 4.9 分钟 |
| 最后 URL 页大小/中文摘要修改后复验 | 5 项相关用例通过，耗时 16.1 秒；未把局部复验说成再次运行完整 99 项 |
| 真实 旧版文件数据库 集成 | 新增 1 项通过，启动隔离后端并使用临时数据库，12 条合成用户跨页查询、复合排序、非法字段拒绝、页面查询与下一页 |
| Go 回归 | domain/repository/handler/service 包通过 |
| Go race | 上述相关包通过 |
| Go vet | `go vet ./...` 通过 |
| 模块依赖 | `go mod tidy -diff` 通过，没有依赖修改 |
| PostgreSQL | 启动本机 Docker 后，用可丢弃 PostgreSQL 17.11 容器执行高级查询及既有字面量搜索回归，两项均通过，并启用 race |
| diff/文档 | `git diff --check` 与文档链接检查通过 |

## 可复现命令

前端：

```sh
npm run lint
npm test
npx tsc -p tsconfig.table-fixtures.json
npm run build
PW_CHROME_CHANNEL=chrome npm run test:e2e
PW_CHROME_CHANNEL=chrome npm run test:e2e -- table-layout-pagination.spec.ts --grep 'M2|users keep scope'
PW_CHROME_CHANNEL=chrome npm run test:integration -- data-table-query.spec.ts
```

后端：

```sh
go mod tidy -diff
go test ./internal/domain ./internal/repository ./internal/handler ./internal/service
go test -race ./internal/domain ./internal/repository ./internal/handler ./internal/service
go vet ./...
```

本次 PostgreSQL 容器使用 tmpfs 数据目录、仅监听 127.0.0.1 的随机端口；验证后删除，未连接业务数据库。最初因 daemon 未运行出现 Skip，随后启动 Docker 并完成真实运行，最终结论来自后者。

PostgreSQL 复验入口：在明确指定的可丢弃测试数据库配置 `INFRANEXUS_TEST_POSTGRES_DSN`，运行 `go test ./internal/repository -run TestAdvancedUserQueryPostgres -v`。不自动连接业务数据库，不输出 DSN。

## 关键断言

- 查询验证拒绝未知/敏感字段、重复排序、错误操作符、范围倒置、无时区日期、超过 20 个条件、危险数值及损坏 JSON。
- 特别覆盖枚举值传入数组/对象，返回无效查询而非 panic。
- Repository 真实 旧版文件数据库 覆盖 OR 不能越过外层 status 范围、跨页顺序和总数一致、日期时区等价及包含边界、NULL-last 多列排序、LIKE 通配符字面量、未知字段。
- HTTP Handler 验证有效 query、页码、部门范围传递；非法 query 返回 400，且不进入服务调用。
- 浏览器覆盖默认视图刷新恢复、重命名/删除确认、过期视图写入冲突、URL 保留其他命名空间、前进后退、URL 页大小、中文输入法结束前不提交。
- 列布局覆盖移动、适配宽度、多列固定持久化、移动端临时降级不修改保存配置；纯函数覆盖系统列、组边界、删除列、宽度上下限和全部隐藏回退。
- 完整回归包含 M1 高度/滚动/全屏/触控、既有用户编辑与并发控制、LDAP、权限、响应式和错误边界场景。

## 应用内浏览器复核

继续使用当前会话 CUA 的 in-app browser，通过隔离环境 `http://127.0.0.1:4175` 登录测试管理员，打开用户管理 → 高级查询 → 添加状态条件 → 应用。实际请求返回 200，表格显示条件摘要。页面身份、非空内容、无框架错误层、对话框和应用动作均已确认，检查时未发现相关前端 error/warn。

隔离 smoke 环境故意不连接 Redis，日志存在连接拒绝与 SSE 503，页面通知区显示重连；这不属于本次表格查询失败，不宣称整个环境无后端错误。测试数据库位于临时目录，验证后关闭服务并清理。

截图与日志为可再生的本地临时证据：

- `/tmp/infranexus-m2-full-e2e.log`：99 项完整回归。
- `/tmp/infranexus-m2-focused-final.log`：最终局部复验。
- `/tmp/infranexus-m2-integration.log`：真实 旧版文件数据库 集成；最终页面复验见 `/tmp/infranexus-m2-integration-final.log`（1 项通过）。
- `/tmp/infranexus-m2-postgres.log`：PostgreSQL 17.11 真实查询及字面量搜索，race 启用，两项通过。
- `/tmp/infranexus-m2-go-final.log`、`/tmp/infranexus-m2-race.log`、`/tmp/infranexus-m2-vet.log`。
- 系统临时目录 `infranexus-playwright-results/`：`m2-query-dialog.png`。
- 系统临时目录 `infranexus-integration-results/`：`m2-real-query-page2.png`。

## 修复与限制

回归中修复了 GORM 多次 Order 合并覆盖 NULL 顺序的问题，改用单个完整排序表达式；新增的三个工具入口曾挤压移动端标题行，现移入搜索筛选行。删除确认测试最初使用错误按钮文案，已按项目实际的“确认删除”修正，未修改原确认组件来迎合测试。

未覆盖项与边界：

1. 历史数据库矩阵覆盖用户查询 Repository 的相同场景；完整浏览器集成使用 旧版文件数据库，未运行 PostgreSQL 浏览器部署矩阵。
2. Firefox/WebKit、真机触摸和原生浏览器菜单 200% 缩放仍未覆盖，沿用 M1 验收边界。
3. 用户列表是本阶段高级查询/视图试点，角色、权限、LDAP 等页面未开放尚无服务端实现的高级查询入口。
4. localStorage 冲突检测没有原子 CAS；极短时间内同时写入的竞争仍可能最后写入者获胜。没有云同步、团队共享和跨设备一致性承诺。
5. 已加载样本适配列宽不是全量数据/复杂单元格精准测量；复杂跨固定区分组布局没有新增承诺。
6. 列 meta 已声明导出/编辑能力类型，但 M3/M4 的具体行为和权限检查尚未实施；声明本身不会创建导出或编辑入口。
