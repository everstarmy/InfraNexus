# M0 验收记录

日期：2026-10-27。状态：M0 已完成；M1–M6 未开始。

基线提交：`e7046d08fb49ac9ff82f90f59efd80f4315c6e03`。本记录描述该提交之上的未提交 M0 改动，不伪造新提交号。

## 1. 交付范围

- 完成 [现状矩阵](M0_BASELINE.md)：七类表格的列数、分页、查询、父布局、权限及后端接口。
- 完成 [契约草案](M0_CONTRACTS.md)：分组配置、状态所有者、兼容参数、恢复顺序、滚动与选择语义。
- 新增 `e2e/fixtures/data-table/{data,render,mount}.ts`，提供九种合成场景；新增 5 项浏览器基线用例，迁移原有 3 项工具栏测试复用挂载工具。
- 新增 `tsconfig.table-fixtures.json`，实际类型检查夹具与两份测试文件；应用原 tsconfig 只覆盖 src，不足以验证这些新增代码。
- 更新任务状态、文档导航与阶段试点。没有改动生产组件、后端、依赖或 UI 原子组件。

## 2. 环境与目标流程

- macOS / arm64；Node v24.11.1；Google Chrome 156.0.8078.48；实际 TanStack Table 9.3.1。
- URL：`http://127.0.0.1:4173`，仓库 Playwright 启动 Vite dev server。
- Browser plugin not available；按测试技能使用现有 Playwright + 本机 Chrome，无浏览器安装或新增依赖。
- 新夹具视口：390×900、1440×900。现有专项包含 375px、宽屏和超宽；具体断言以测试文件为准。
- 目标流程：登录壳身份检查 → 隔离挂载真实 DataTable → 搜索/重置/翻页/水平滚动/树展开/错误重试 → 验证可见状态。
- 所有 API 为 mock；未知夹具接口返回 501，不回退访问真实服务。

## 3. 实际执行结果

命令在 frontend 目录执行，除明确说明的仓库级检查。

| 检查 | 命令 | 结果 |
|---|---|---|
| 修改前专项基线 | `PW_CHROME_CHANNEL=chrome npm run test:e2e -- data-table-toolbar.spec.ts table-layout-pagination.spec.ts roles-pagination.spec.ts ldap-page-regressions.spec.ts` | 33/33 通过，约 1.3 分钟 |
| 新夹具与工具栏迁移回归 | `PW_CHROME_CHANNEL=chrome npm run test:e2e -- data-table-baseline.spec.ts data-table-toolbar.spec.ts` | 8/8 通过，18.3 秒 |
| 静态检查 | `npm run lint` | 通过 |
| 现有单元测试 | `npm test` | 5 文件、17/17 通过 |
| 应用构建 | `npm run build` | TypeScript/Vite 通过；仍有 500kB 分包提示 |
| 测试夹具类型 | `npx tsc -p tsconfig.table-fixtures.json` | 通过；修复夹具后再次通过 |
| 文档与改动检查 | 相对链接检查、任务 ID/状态检查、`git diff --check` | 通过 |

33 项基线中的 3 项工具栏测试在修改后已重跑，其余生产代码与对应测试未改动。不要将两次运行相加宣称 41 个独立用例；本轮覆盖 38 个不同 E2E 用例。

过程中的失败及处理：

1. 首次受限环境下 Chrome 启动被沙箱阻止，测试无法执行；使用工具授权本机运行后，33 项基线全部通过。环境失败不作为产品缺陷或通过结果。
2. 新夹具首轮 6 失败、2 通过：夹具将 `cell: undefined` 显式写入列配置，覆盖默认单元格渲染，导致文字为空。改为明确渲染行名称，重跑 8 项全部通过。未修改生产代码来绕过断言。

## 4. 行为证据

| 检查 | 结果与边界 |
|---|---|
| 页面身份与非空 | mount 校验 /login、InfraNexus 标题和登录按钮；随后校验 fixture 表头或加载/错误状态 |
| 框架覆盖层 | mount 检查无 vite-error-overlay；新宽表/长文本流程收集 pageerror 和相关 console error |
| 控制台 | 测试通过；登录壳 /auth/me 的 401 是预期响应。Node NO_COLOR/FORCE_COLOR 提示属于测试环境 |
| 搜索与工具栏 | 390/1440px 搜索 Alpha 后 Beta 消失、Escape 清空恢复、刷新回调触发；原独立显隐/legacy 标题断言保留 |
| 分页 | 120 条每页 10 条，跳到第 12 页出现成员 120 |
| 水平滚动 | 21 列确实溢出，滚至右端后第 20 个扩展列在视口内 |
| 错误/加载/空表 | 错误与空表区分；重试后数据可见；加载显示 skeleton 而不是空结果 |
| 树与权限 UI | 1 根+3 子行收起为 1 行，再展开为 4 行；整表禁选且编辑按钮禁用 |
| 截图复核 | 已查看 390px 长文本和 1440px 工具栏截图；长文本保持现有横向滚动行为，没有冒充已实现截断/换行功能 |

原始日志：`/tmp/infranexus-m0-baseline.log`、`/tmp/infranexus-m0-fixtures.log`。

截图在系统临时目录的 `infranexus-playwright-results/` 下，名称包括 `m0-long-text-390.png`、`m0-long-text-1440.png`、`infranexus-toolbar-v2-390.png`、`infranexus-toolbar-v2-1440.png`。这些是本机临时证据，后续 Playwright 运行可能清理；仓库保留可重跑测试及本记录，不把截图/trace 提交到源码。

## 5. 未覆盖和回退

- 未执行 Firefox/WebKit、深色/200% 缩放完整矩阵、真实后端/SQLite/PostgreSQL/race/vet；本轮没有后端或生产行为修改。这些不计为通过。
- 未测 M1 最大高度/吸顶表头、M2 高级筛选/视图、M3 行级选择/全量操作等尚未实现能力。
- `no-permission` 是合成 UI 状态，不证明服务端权限校验；错误恢复是组件宿主状态测试，不代替真实网络重试集成测试。
- 未做性能基准测量，不对大型数据量作吞吐承诺。
- 回退只需恢复工具栏测试原挂载方式并移除新增夹具/测试配置；生产运行路径不依赖这些文件。

## 6. M0 任务证据映射

| 任务 | 完成依据 |
|---|---|
| DT-000 | 基线提交、工作区说明与生产文件未变更 |
| DT-001 | M0_BASELINE 页面矩阵，真实生产规模明确未读取 |
| DT-002 | M0_CONTRACTS 分组/兼容草案；本地 v9.3.1 类型核对；夹具类型检查 |
| DT-003 | M0_CONTRACTS 高度试点、恢复优先级、滚动/选择作用域与偏好规则 |
| DT-004 | M0_BASELINE 现有 API、权限、单排序/版本更新与缺口 |
| DT-005 | 九种可复用场景、5 个新增浏览器用例，已有工具栏复用 |
| DT-006 | 17 项单测、33 项原专项及迁移后 8 项回归，环境失败与夹具修复已登记 |
| DT-007 | M0_BASELINE 阶段试点/暂缓矩阵，TODOLIST 验证模板与本记录 |
