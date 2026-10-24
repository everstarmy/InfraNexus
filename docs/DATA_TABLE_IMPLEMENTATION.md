# Data-table 优化实施与验收

日期：2026-10-24。基于功能源码审查及 1440/1024/375px 浏览器视觉审查。

## 已实施

- 列设置：320px 视口约束 Popover；每列一个显示开关及固定位置三图标组合按钮；搜索、显示数量、恢复默认；连续操作保持打开；至少保留一个数据列。
- 列宽：显式 colgroup；叶子列宽正确应用；剩余宽度优先分配主要数据列；用户表来源、状态、日期等采用内容宽度基线。
- 窄屏：按表格容器宽度观察，小于 640px 临时取消数据列固定，保留操作列；不修改持久化偏好。
- 滚动：移除外层重复横向滚动容器；表格及列设置使用局部细滚动条，不修改页面主滚动条。
- 行反馈：固定单元格跟随行悬停/选中背景；行点击排除按钮、链接及其他交互控件。
- 筛选：外部搜索、受控分面进入筛选状态及重置；服务端重置回首页。
- 排序：服务端筛选模式未接入受控排序时关闭排序能力；表头输出 aria-sort。
- 选择：未声明自定义作用域且未开启持久化时，分页/排序/筛选变更清除选择及 Shift 锚点；批量文案不再错误声称所有结果均来自当前页。
- 分页：已加载数据的页码超过有效范围时回退到有效页。
- 日期与加载：近 N 天包含今天共 N 个自然日；骨架按可见数据列计算，选择列不重复。
- 可访问性：去除筛选触发器内部无键盘处理的伪按钮；清空继续通过浮层内真实按钮操作；搜索增加名称。
- 性能：以列 schema、默认布局的稳定序列化值为依赖，避免页面内联对象引发重复 localStorage 读取。

## 后续阶段（尚未实施）

这些是原方案的扩展能力，不能视为本轮已交付：

1. 将状态协调、偏好、选择、布局拆为独立 Hook，补完整受控状态类型约束及列 meta。
2. 跨页选择 ID 契约及后端“全部筛选结果”能力；本轮继续使用现有 batchActions 原始行接口。
3. 移动端列设置改抽屉、组织树折叠策略、标准/紧凑密度。
4. 可触达的同步横向滚动控制、溢出边缘提示、可配置吸顶表头、拖宽参考线。
5. 统一输入法感知的搜索提交、防抖、外部日期接口、页面级清除全部条件接口。
6. 权限树大规模展开性能测量、必要时引入虚拟化。
7. 扩展日期/URL/选择边界单测、深色主题和 Windows/Firefox/WebKit 验收。

## 验收方式

- 单元测试：`npm test`。
- 构建：`npm run build`；当前存在 Vite 大包提示，非本轮引入的错误。
- 专项浏览器：`PW_CHROME_CHANNEL=chrome npm run test:e2e -- table-layout-pagination.spec.ts`。
- 专项覆盖：宽屏 1440/2560/3840/6014、375px 手机、分页跳转/空表、固定偏移、列宽键盘操作、偏好恢复、列设置连续操作/搜索/恢复默认、外部搜索重置、未实现排序入口、手机面板边界及窄屏解除固定。
- 使用拦截 API 的模拟数据，未依赖或修改真实业务数据；截图输出到 /private/tmp。
- 原子组件 `components/ui/` 未修改；未安装依赖。

最终结果：17 项单元测试通过，10 项表格专项 E2E 通过，TypeScript/Vite 构建通过，git diff --check 通过。浏览器测试使用本机 Chrome；开发服务器需重启以确保加载最新源文件。

列设置交互修订：左固定 / 不固定 / 右固定使用 ToggleGroup，一次点击切换；每侧仅保留一个业务列，新选择替换旧选择，保留选择列/操作列系统固定。读取旧偏好时自动收敛多列固定。

部门页面布局修订：部门成员标题、含下级开关与刷新/列设置共用工具栏；部门详情的上级路径、名称、编码和状态合并为紧凑单行。新增部门页面浏览器用例验证标题对齐、高度、开关和手机无横向溢出；单独回归通过。三图标修订后的 11 项专项用例通过。

## 头部布局修订方案（2026-10-24）

本轮仅完善现有表格封装，不新增业务功能。实施顺序：明确插槽与显隐接口，拆分两行布局，迁移现有页面，运行浏览器回归。

- 第一行：`toolbarTitle` 标题及说明；右侧 `toolbarControls`、刷新、列设置、`actions`。旧 `toolbarLeading` 作为标题插槽兼容别名，优先使用 `toolbarTitle`。
- 第二行：`searchLeading`、内置搜索、内置筛选与重置、`searchTrailing`。无内容不渲染；列标题排序保持原行为。
- `hideRefresh` 与 `hideViewOptions` 默认 `false`，分别隐藏刷新与列设置；刷新仍需提供 `onRefresh`。
- 移动端搜索占满一行，筛选保留现有展开按钮；自定义插槽始终可见，空间不足时自然换行。标题操作行允许必要换行，不截断操作按钮。
- 保留批量操作、搜索快捷键、服务端筛选及布局偏好行为；业务页面负责在查询错误状态下保留标题和可用筛选。

示例：

```tsx
<DataTable
  columns={columns}
  data={items}
  toolbarTitle={<div><h2>同步日志</h2><p>同步结果与失败明细</p></div>}
  searchLeading={domainFilter}
  searchTrailing={extraFilters}
  hideSearch
  onRefresh={refresh}
  hideRefresh={false}
  hideViewOptions={false}
/>
```


本轮已完成并验收：

- LDAP 同步日志采用 `toolbarTitle` + `searchLeading`；部门成员标题进入第一行，“含下级部门”筛选进入第二行。旧标题插槽仍可用。
- 新增 `frontend/e2e/data-table-toolbar.spec.ts` 验证 390/1440px 标题操作同排、搜索区前后插槽、独立隐藏内置按钮、完全隐藏头部、无搜索时移除第二行、旧插槽兼容，以及搜索快捷键、清空和刷新交互。
- `PW_CHROME_CHANNEL=chrome npm run test:e2e -- data-table-toolbar.spec.ts ldap-page-regressions.spec.ts table-layout-pagination.spec.ts`：20/20 通过。LDAP 另覆盖 1280/1920px，既有表格覆盖 375px 至 6014px；分页、列固定/显隐/偏好、错误恢复均通过。
- `npm run lint`、`npm test`（17/17）、`npm run build`、`git diff --check` 通过；构建仍有原有 500kB 分包提示。
- Browser plugin not available；使用现有 Playwright 与本机 Chrome，地址 `http://127.0.0.1:4173`。使用模拟 API，未修改真实业务数据；截图保存 `/tmp/infranexus-toolbar-v2-390.png`、`/tmp/infranexus-toolbar-v2-1440.png` 并完成人工视觉核对。新插槽测试无页面运行异常，既有页面回归包含页面身份、错误浮层与控制台检查；401 为登录测试夹具的预期响应。
- 本轮未验证 Firefox/WebKit，不改变现有查询错误处理与业务接口。

### 用户管理遗漏接入修复

用户管理原先在 DataTable 外单独渲染范围标题 CardHeader，导致“标题 / 操作 / 搜索筛选”占用三行。现将范围标题、人数及组织架构展开入口一并传入 `toolbarTitle`，保留查询错误状态下的标题与组织树入口。业务卡片不得再在共享标题操作行外重复渲染同一表格标题。

新增页面级回归 `users keep scope title and table controls together above filters`：390/1280/1920px 检查标题与刷新中心对齐、筛选位于下行、页面无横向溢出，以及组织架构收起/展开可用。此用例在修复前失败，修复后通过；已人工核对桌面与移动端截图。

本次验证：`PW_CHROME_CHANNEL=chrome npm run test:e2e -- table-layout-pagination.spec.ts` 13/13 通过；Lint、构建和 diff 检查通过。构建仍为既有大包提示。
