# M4 验收记录

当前数据库支持范围为 PostgreSQL。下文涉及旧版文件数据库的结果是当时的验收记录。

日期：2026-10-29。基线 `b062db7`，M4 工作区改动；未新增依赖，未修改 components/ui 原子组件。

## 已取得证据

- lint、TypeScript/Vite 构建通过；Vitest 8 个文件、33 项通过。既有入口 chunk >500kB 提示保留。
- M4 浏览器专项 5 项通过：昵称版本冲突后显式核对；草稿跨页、Tab 不保存、离页取消/Escape；详情失败重试和缓存；权限节点懒加载失败重试/空态/祖先计数；选择期间保持旧快照并显式接受新数据。
- M3 跨页选择与已有高频交互回归 7 项通过。新增故障/权限与分组视觉连选专项 2 项通过：503 后保留草稿、执行中禁用重复操作、权限刷新后禁用保存，以及分组后 Shift 只选择视觉范围内记录。
- 真实 旧版文件数据库 HTTP：`go test -race ./internal/bootstrap -run 'TestPermissionNodes|TestUserText|TestUserProfile' -count=1` 通过；验证根分页、关键词保留祖先、子节点范围、未知/超限参数、未登录及普通用户越权，以及已有用户资料白名单与 CAS。
- 历史文件数据库用例与 `TestPermissionNodeScopePostgres` 均启用 race 并通过。PostgreSQL 17.11 临时容器真实验证路径保留、过滤计数、叶节点空态；已删除临时容器。该证据不等同 PostgreSQL 全套 HTTP 编辑测试。

- 相关 domain/service/handler/bootstrap 包 race 回归通过，bootstrap 约 186 秒；`go vet ./...` 通过。
- 第一轮完整 E2E 为 102 通过、2 项因并行运行共用产物目录导致 trace 文件 ENOENT；两项均发生在浏览器上下文清理阶段。最终改用独立目录 `/tmp/infranexus-m4-final-results`，完整回归 **106 项全部通过（5.0 分钟）**；包含两个新增故障/权限及分组视觉连选用例。

## 环境与限制

浏览器使用已安装 Chrome 的 Playwright 自动化，交互测试 API 为 mock；真实服务端语义另由 HTTP/数据库测试验证。没有宣称真实触摸设备、Firefox/WebKit 或数据库故障恢复联测通过。

昵称冲突测试偶发出现 `ResizeObserver loop completed with undelivered notifications` 控制台提示，交互断言仍通过；调整表格 observer 调度未消除提示，因此未保留无证据的修改或屏蔽错误。该提示列为已知限制，不标记为修复。

权限目录尚未优化为数据库按需扫描，用户汇总仅当前页计数。未实现任意金额聚合、自动保存、多字段通用编辑器，详细契约见 [M4 接入说明](M4_IMPLEMENTATION.md)。

临时日志：`/tmp/infranexus-m4-{build,lint,unit,focused,final-focused,e2e-all,e2e-final,api,db-postgres,go-regression,vet}.log`。权限树截图：`/tmp/infranexus-m4-tree.png`。临时产物不提交仓库。
