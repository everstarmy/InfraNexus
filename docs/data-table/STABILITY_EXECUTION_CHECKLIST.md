# DataTable 稳定性整改执行清单

日期：2026-10-31。执行者：Sol；复核者：主代理。目标是修复维护成本和验证缺口，不扩充业务功能。

## 0. 执行协议与红线

- 开始前读取根目录及适用的 AGENTS.md，记录 HEAD、工作区状态；不得覆盖用户已有改动。
- 允许范围：`frontend/src/components/data-table/`、对应 `frontend/e2e/data-table*.spec.ts` 与表格 fixture、`frontend/perf/` 的表格专项、`docs/data-table/`。确有必要的测试配置调整须说明原因。
- 禁止修改 `frontend/src/components/ui/`、后端、无关页面和依赖；不得新增公开 API 或更改既有默认值。内部模块不加入公共 barrel。
- 保留 start/center/end 顺序、单个首选可伸展数据列、sizedLayout 全部既有触发条件、窄屏预算及辅助列优先级。stickyActionColumn 单独启用时仍使用 auto 布局。
- 保留 headerClassName/cellClassName、受控优先级、事件传播、存储键及格式、权限和敏感值规则。
- 不增加列虚拟化、编辑系统、国际化、全量导出或格式化导出接口。
- 禁止删除/跳过既有测试、弱化断言、提高性能阈值或更新截图来掩盖失败。遇到既有问题先复现并区分来源。
- 每批完成后运行 unit/lint/build，记录命令、结果与失败原因。实现顺序 B1→B2→B3→B4，依赖步骤不得跳过。
- 每批作为独立可审查差异；本次先保留工作区，不自动推送。若创建提交，须仅包含本任务文件并记录对应批次。
- 日志和临时性能产物放临时目录，不把大量生成文件写入仓库。E2E 同时只运行一个，期间不修改文件，避免 Vite reload 干扰。

## 1. B1：可读性与文档基线

- [x] B1.1 记录当前 API/默认值和测试入口，核实旧验收数量仅代表历史整体验收。
- [x] B1.2 只格式化本次需改动的表格实现，展开超长 JSX/条件/导出流程；保持执行顺序与依赖数组不变，不全仓格式化。
- [x] B1.3 修正 README 旧章节引用为有效锚点；核对导出名、props、默认值。明确当前页、已加载数据、全部匹配结果的差异。
- [x] B1.4 核对 README 中服务端示例类型（可用临时 TSX 纳入现有编译后移除），检查本地链接/锚点。不得为通过检查改变示例语义。
- [x] B1.5 运行每批三项验证，记录格式化和文档变更无运行时行为差异。

交付：可读代码、修订 README、执行记录。检查格式变化与语义变化可区分。

## 2. B2：主组件职责提取

先读完整 data-table.tsx 和调用点；创建下列内部模块时可根据真实职责调整名称，必须记录调整理由。禁止大型共享 Context、循环依赖、any 类型逃逸及重复状态源。

- [x] B2.1 提取 `data-table-compatibility.ts` 纯函数：输入当前虚拟化配置及其所需事实，输出 enabled 与既有回退原因；提示文案、优先级、兼容模式分页行为不变。
- [x] B2.2 为兼容判断补充表驱动测试：未启用、稳定 ID、限高/fill、mobileContent、detail/groupBy、非法高度/ID、手动兼容模式。覆盖同时不满足多个条件时原有原因优先级。
- [x] B2.3 提取模块顶层内部表头组件：接受 header groups、列样式/几何适配和必要回调，保留 resize label、键盘步进/方向、aria-sort、colSpan、sticky 层级、用户 headerClassName。
- [x] B2.4 提取模块顶层正文行组件：接受 row、选择/展开状态、必要处理器、样式适配、虚拟属性；保留 row key、DOM 结构、测量 ref、data-index、aria-rowindex、detail ID、cellClassName 及事件拦截。
- [x] B2.5 集中布局样式适配：复用唯一几何结果，不重新实现宽度/固定算法；自然布局的 offset 行为保持不变。可先保留主组件稳定回调，避免引入无收益抽象。
- [x] B2.6 主组件保留 Table 装配、受控状态和组件编排。不以行数减少为验收标准，不盲目添加 memo。
- [x] B2.7 增补回归：状态更新不重挂载输入/菜单；行内操作不误触行选择；展开后 aria-controls 仍有效；虚拟测量和焦点保留。优先复用已有测试，仅补缺口。
- [x] B2.8 每次提取后跑相关测试，整批运行三项验证与相关表格 E2E。

验收：无公开接口变化；数据/焦点/选择/展开/滚动行为等价；表头与行组件不在 render 内定义。

## 3. B3：几何成本与组合证据

- [x] B3.1 在优化前记录生产构建性能基线，使用现有表格 perf 工具；记录浏览器、运行命令、数据规模、重复次数和构建版本。
- [x] B3.2 优化 computeTableGeometry 的逐列 findIndex/slice/reduce：固定集合、开始侧前缀和、结束侧后缀和，使核心偏移生成 O(C)。不更改重复/无效 ID 的既有处理契约。
- [x] B3.3 保留现有几何矩阵，增加空列、全部固定、隐藏列、混合固定、固定预算边界、分组表头聚合测试。可在测试中保留旧算法作为对照，不留双份生产实现。
- [x] B3.4 检查渲染路径是否重复计算几何；只有测量支持时才加缓存。依赖必须覆盖列顺序/宽度/可见性/固定状态/容器尺寸。
- [x] B3.5 在 README 或独立组合矩阵中逐项记录：虚拟化×详情、平面分组、树形、mobileContent；固定×显隐/重排/调宽；受控选择×翻页/筛选/刷新；视图恢复×列变更；密度×动态高度/锚点。
- [x] B3.6 各组合标明支持/条件支持/既有回退，并链接实际测试。验证回退不丢数据、提示准确、分页大小和恢复行为可预期；不强行支持原本不支持的组合。
- [x] B3.7 相同生产构建方式及相同机器重复测量优化前后，至少普通分页、万行虚拟表、宽表、复杂单元格、密度/刷新场景。报告中位数与范围，明确未测指标；不能从一次结果宣称提升。
- [x] B3.8 三项验证与几何/虚拟化专项 E2E。性能噪声导致无法证明提升时如实记录，不伪造结论。

交付：线性几何实现、等价性证据、组合矩阵、性能前后记录。测试工具确实无法覆盖某场景时记录限制并向复核者报告。

## 4. B4：导出契约与最终验收

- [x] B4.1 将 clipboard 内数据收集、序列化、下载步骤拆成可读的内部函数；保留现有公共签名和返回值、matrix TSV 重载。
- [x] B4.2 数据仍来自 row.getValue()；保留可见列 start/center/end 顺序、辅助列排除、meta.export.enabled/label、列名回退优先级。CSV/TSV 不自动应用 UI 格式化。
- [x] B4.3 补充真实 table 模型测试：隐藏/重排/固定列、分页、空表、树形展开和分组实际行模型；固定导出范围而非假设所有 loaded rows。
- [x] B4.4 补充转义/安全测试：中文、引号、逗号、CR/LF、tab、空值、公式前缀及空白前缀、字符串大整数和不安全整数。记录日期/数组/对象既有 String 行为，不默默改语义。
- [x] B4.5 下载测试验证 anchor 移除、URL 撤销、序列化失败不创建资源；以异步 timer 测试覆盖实际清理，不通过永久延长 timer 掩盖泄漏。
- [x] B4.6 更新 README 导出说明及最终架构链接，完成单测、Lint、Build。
- [x] B4.7 冻结文件修改，单独运行完整 Playwright E2E；核对明暗主题、RTL、窄屏、键盘、ResizeObserver 错误覆盖。结束后再写验收结果文档。
- [x] B4.8 检查 git diff --check、改动文件白名单、公开导出差异；提交给复核者最终 diff 与验证记录。

## 5. 标准命令与停止条件

每批：
```sh
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
```

最终浏览器（若本机 Chrome 配置适用）：
```sh
PW_CHROME_CHANNEL=chrome npm --prefix frontend run test:e2e
```

性能使用 package.json 中现有 test:table-perf/对应配置，先读取脚本确定服务与端口；不与完整 E2E 同时运行。

遇到需改变既有 API/行为、修改禁区、引入依赖或验收失败无法解释时，停止该项并向主代理报告具体证据，继续不依赖它的已授权任务。普通实现选择无需反复征询用户。

## 6. 执行记录

每批追加：完成任务 ID、实际文件、行为变化（应无或有明确缺陷说明）、验证命令/结果、性能数据、未覆盖项、复核意见。不勾选尚未验证的任务。

### B1 完成（2026-10-31）

- 起点 HEAD `9dfa36913743f35ebc6d523b056b2df02a2edf1e`；仅清单为主代理新建，其他工作区干净。Browser plugin not available，使用仓库 Playwright。
- 格式化限于主组件、几何及导出三个后续需要修改的实现；Prettier 只调整排版，无行为变化。API/默认值核对主组件、types 与 barrel，未改变。README 修正旧第 5/10 节引用，补齐 CSV 导出名和当前行模型范围。
- README 服务端标准示例临时写入 src 后运行完整 build，通过后移除；本地文件及锚点检查通过。历史验收数字仅代表当时整体验收；本轮入口为 package.json 的 test/lint/build、test:e2e、test:table-perf。
- `npm --prefix frontend test -- --run`：19 files / 338 tests 通过。`npm --prefix frontend run lint` 通过。`npm --prefix frontend run build` 通过（现有 bundle size 提示）。日志 `/tmp/data-table-b1-{unit,lint,build}.log`。
- 性能首次沙箱内 Chrome launch 失败（EPERM），已按正常 escalation 重跑，未改断言。基线仍采集原行为。

### B2 完成（2026-10-31）

- 提取内部 `data-table-compatibility.ts`、`data-table-header.tsx`、`data-table-body-row.tsx`、`data-table-styles.ts`，未加入 barrel。样式工厂仍复用本轮唯一几何结果与原自然布局 offset，未增加 memo/Context/状态源。主组件保留 Table、受控优先级和编排。
- header/row JSX 与事件原样迁移，row key、虚拟 ref/data-index/aria-rowindex、详情 ID、用户 className、resize 键盘步进保持；兼容判断新增 17 个表驱动用例（稳定 ID 指是否提供 getRowId，未新增 ID 格式校验以免改变契约）。
- 补充 fixture 探针与 `data-table-stability.spec.ts`，真实浏览器验证更新后输入 DOM/草稿与已开菜单 DOM 不重挂载、详情 aria-controls 有效、行内操作不触发行点击、输入 Enter 保持焦点。已有布局回归覆盖 RTL resize 和滚动。
- unit 20 files / 355 tests；lint/build 通过。相关 E2E：`PW_CHROME_CHANNEL=chrome npm --prefix frontend run test:e2e -- e2e/data-table-stability.spec.ts e2e/data-table-layout.spec.ts e2e/data-table-optimization.spec.ts`：45 passed（1.3m），期间未修改文件。日志 `/tmp/data-table-b2-*.log`。
- B3 前原实现生产基线：现有 perf 6 passed / 1 failed，失败为既有密度锚点（row-273 变密度后未挂载），详见 `/tmp/data-table-stability-before.log` 和 `/tmp/data-table-stability-before.json`，继续单独定位。

### B3 完成（2026-10-31）

- `computeTableGeometry` 使用固定ID集合、开始前缀与结束后缀 Map，保留重复ID首次位置、start优先、原预算与辅助优先级。旧算法仅保留于测试作对照，200个扩展等价组合含空/全部固定/隐藏/重复/无效ID及浮点宽度容差，另加预算边界和分组宽度。渲染仍每轮只算一次几何，未引入新缓存。
- [组合矩阵](STABILITY_COMBINATIONS.md)、[性能记录](STABILITY_PERFORMANCE.md) 记录实际支持/条件/回退与限制；补充普通分页、复杂单元格、密度/刷新3×3次测量。
- 原性能基线发现密度锚点既有失败。最终修复：重建测量后按ID定位新范围，受清理的单个RAF测量新DOM、结束命令并恢复像素偏移；仅虚拟容器禁浏览器原生锚点避免双补偿。新增动态组合前置等待初次RO测量就绪，扩大20/20通过；未对尚在初次测量过程的切换作稳定保证。未保留诊断console或实验同步重试。
- unit 20 files / 557 tests、lint/build通过。几何后layout E2E 28/28；最终生产perf/虚拟化9/9通过（17.2s），原200ms门槛不变。日志 `/tmp/data-table-b3-{unit,lint,build,e2e}.log`、`/tmp/data-table-b3-perf-final.log`、`/tmp/data-table-density-settled.log`。性能波动不支持宣称端到端提速。
- 自动审批曾拒绝用HEAD整文件覆盖移除本轮实验（防止丢未提交修改）；未执行，随后核对diff并用精确apply_patch移除本轮实验，不存在待审批阻塞。

### B4 实现完成，进入文件冻结（2026-10-31）

- 导出拆为内部收集/序列化/下载函数，公开签名及matrix TSV重载不变，数据仍来自row.getValue()，表格行模型范围不变。真实DataTable模型测试覆盖隐藏/重排/两侧固定、meta标签优先级、原始值、客户端分页、服务端一页、空表、树形展开/收起和平面groupBy。
- 安全转义补充中文、引号、逗号、CR/LF、tab、空值、公式/空白/控制前缀、大整数字符串与不安全整数；明确Date/array/object的String行为。下载测试通过异步fake timer执行真实清理回调，覆盖anchor移除、URL撤销、click失败清理、序列化失败零资源。
- unit 22 files / 569 tests；lint/build通过。README两个完整服务端示例临时纳入build通过后移除；文档本地链接/锚点和文件白名单检查通过，barrel/types未改。日志 `/tmp/data-table-b4-{unit,lint,build,readme-build,clipboard}.log`。
- 补充浏览器fallback数据完整性用例：detail/group和mobileContent回退保持页大小、下一页及末页数据；将随最终完整E2E验证。现在冻结文件，完整E2E结束后再追加最终结果。

### B4 最终验收完成（2026-10-31）

- 文件冻结后单独执行 `PW_CHROME_CHANNEL=chrome npm --prefix frontend run test:e2e`：**143 passed（6.0m）**，日志 `/tmp/data-table-final-e2e.log`。全程无文件编辑、无其他并行E2E。结束后仅追加验收文档。
- 覆盖明暗主题、RTL、390/375等窄屏、200%缩放、键盘/焦点、固定/显隐/重排/调宽、输入和菜单不重挂载、行操作隔离、详情aria-controls、回退后下一页/末页数据、跨页选择/刷新/视图恢复。相关测试pageerror/console检查包含ResizeObserver错误，未屏蔽错误。既有ux-hardening故障注入测试会主动制造动态模块加载失败并验证错误边界，不能将该预期日志误认为表格运行错误。
- 使用TypeScript AST printer移除注释及函数体后比较HEAD与当前主组件、clipboard、geometry全部公开声明，三者完全一致；index.ts/types.ts无diff。内部新模块不入barrel。
- 最终文档本地链接/锚点、`git diff --check`、改动文件白名单通过；没有backend/ui/依赖/无关页面变更，没有提交或推送。完整结果见 [验收记录](STABILITY_VALIDATION.md)。
