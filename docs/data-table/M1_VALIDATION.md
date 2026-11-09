# M1 验收记录

当前数据库支持范围为 PostgreSQL。下文涉及旧版文件数据库的结果是当时的验收记录。

日期：2026-10-28。源码基点：`e7046d08fb49ac9ff82f90f59efd80f4315c6e03` 加当前工作区 M0/M1 改动，尚未创建本阶段提交。

## 交付范围与证据

| 任务 | 实现与验证 |
| --- | --- |
| DT-100–102 | `data-table-layout.ts` 高度判别联合和校验；`data-table-viewport.tsx` 单滚动区；短表、空表、骨架、非法高度、fill 和 180px 小父容器 E2E |
| DT-103–104 | 整体 thead sticky，使用浏览器实际布局处理两层分组表头，无需逐行累计偏移；固定列与纵横滚动几何断言 |
| DT-105–107 | 工具栏/分页在视口外，横向按钮/阴影首尾边界；骨架沿用同一区域，页面错误由原 QueryErrorState 负责 |
| DT-108 | 刷新、新增首行锚点、卸载返回加载中、异步查询落地、翻页、视图切换的位置断言 |
| DT-109 | 三档菜单、旧偏好默认、用户/表格持久化、粗指针 44px 数据按钮断言 |
| DT-110 | truncate/clamp/wrap，Enter 查看全文，Escape 焦点返回，触摸入口 |
| DT-111 | 全屏保留滚动，密度菜单优先处理 Escape，退出全屏恢复入口焦点 |
| DT-112–114 | 用户/角色/部门/权限/LDAP 接入；固定列调宽、隐藏、深色、横向首尾组合；现有页面回归 |
| DT-115 | 375/390/768/1440/1920px，深色、CSS zoom:2、键盘、粗指针触控模拟；原生浏览器菜单 200% 缩放及真机触摸仍未覆盖 |
| DT-116 | lint、单元、类型检查、构建与 E2E；实际 API 见 [接入说明](M1_IMPLEMENTATION.md) |

## 命令与结果

在 `frontend/` 运行：

```sh
npm run lint
npm test
npx tsc -p tsconfig.table-fixtures.json
npm run build
PW_CHROME_CHANNEL=chrome npm run test:e2e
PW_CHROME_CHANNEL=chrome npm run test:e2e -- data-table-layout.spec.ts --output=/tmp/infranexus-m1-layout-final
```

- lint、夹具类型检查通过。
- Vitest：6 个文件、21 项通过（包括新增 4 项配置校验）。
- 构建通过；Vite 提示入口 chunk 超过 500kB，本阶段没有进行无关分包优化。
- 完整 E2E：95 项中 94 项通过，1 项触屏按钮高度失败（32px 而非 44px）；修复选择器优先级后，独立复跑全部 16 项 M1 E2E，16 项通过。没有将首次完整运行写成全绿；其余 79 项未发现失败。
- 修复后再次通过 lint、夹具类型检查及生产构建。
- 完整运行日志：`/tmp/infranexus-m1-final-e2e.log`；修复后日志：`/tmp/infranexus-m1-layout-final.log`，截图目录 `/tmp/infranexus-m1-layout-final/`。
- 完整运行中的 reduced-motion 提示来自测试主动启用减少动画；动态模块加载错误来自错误边界用例主动拦截模块，两者对应测试通过。

测试文件：`frontend/e2e/data-table-layout.spec.ts`（16 项 M1 用例），复用 M0 夹具及现有页面 E2E。测试运行的 API 为 mock，不能据此声称真实后端或数据库集成通过。本阶段未改后端，未运行 Go race/vet 或数据库回归。

修复过程中发现并回归：全屏 Dialog 提前卸载导致焦点恢复失败；密度单选菜单默认不关闭；触屏最小按钮高度被较高优先级的密度选择器覆盖。均通过对应行为断言验证，不将失败尝试计入通过结果。

## 应用内浏览器复核

通过当前会话的 CUA 浏览器入口连接 in-app browser，并非根据缺少历史 `browser` 技能名称推断插件未安装。现有 Playwright 测试用于可复现自动回归。

验证入口：`http://127.0.0.1:4173/e2e/fixtures/data-table/index.html`。这是仅供 Vite 开发环境加载的合成夹具，生产构建不导入该入口。

| 检查 | 结果 |
| --- | --- |
| 页面身份 | 标题为 InfraNexus · DataTable M1 验证 |
| 非空白/无框架覆盖层 | 50 行、单个 table-container，截图无 Vite 错误层 |
| 全屏与焦点 | 打开全屏、退出后入口按钮重新获得焦点 |
| 密度交互 | 点击紧凑，data-density 变为 compact，菜单关闭 |
| 控制台 | 该夹具交互检查没有相关 error/warn |
| 截图 | 可见固定列、受限数据区、独立分页与滚动按钮 |

截图由 E2E 保存在系统临时目录 `infranexus-playwright-results/`，含 `m1-grouped-scroll.png`、`m1-fill-pinned.png` 和 `m1-dark-zoom-*.png`。这些是可重新生成的本地证据，不是仓库持久资源。

## 限制与后续验证

- 当前自动化引擎为本机 Chrome/Chromium；Firefox/WebKit 未运行，不声称跨引擎验收完成。
- CSS zoom:2 检查放大后的布局，不等同于浏览器菜单 200% 缩放。原生缩放与真机触摸保留在 DT-115 的补验事项中，不能以模拟结果替代。
- 固定分组标题已验证两层整体固定，跨左右固定区的复杂分组拆分未实现。
- 锚点恢复依赖稳定行 ID；返回缓存仅限当前运行期，不跨刷新，不恢复业务查询本身。
- 极小高度采用外层滚动兜底。fill 宿主应设置确定高度、min-h-0 及必要的 overflow-y-auto。
- 全屏重建单元格 DOM；未提升到表格/业务页的自定义 cell 内部状态不保证保留。
- M2–M6 未开始。
