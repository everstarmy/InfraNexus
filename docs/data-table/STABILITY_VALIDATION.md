# DataTable 稳定性整改验收

2026-10-31，执行者 Sol，待主代理复核。起点 HEAD `9dfa36913743f35ebc6d523b056b2df02a2edf1e`，保留未提交工作区。授权清单 [B1–B4 执行记录](STABILITY_EXECUTION_CHECKLIST.md) 全部完成。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| B1 单测 / Lint / Build | 338 tests + 两项通过 | `/tmp/data-table-b1-*.log` |
| B2 单测 / Lint / Build | 355 tests + 两项通过 | `/tmp/data-table-b2-*.log` |
| B2 表格布局与稳定性 E2E | 45/45 | `/tmp/data-table-b2-e2e.log` |
| B3 单测 / Lint / Build | 557 tests + 两项通过 | `/tmp/data-table-b3-*.log` |
| B3 几何后布局 E2E | 28/28 | `/tmp/data-table-b3-e2e.log` |
| B3 最终生产性能 / 虚拟化 | 9/9，17.2s，原200ms门槛不变 | `/tmp/data-table-b3-perf-final.log` |
| 密度固定/动态组合重复验证 | 20/20，18.4s，动态分支先确认初次RO测量就绪 | `/tmp/data-table-density-settled.log` |
| B4 最终单测 / Lint / Build | 22 files / 569 tests + 两项通过 | `/tmp/data-table-b4-{unit,lint,build}.log` |
| README 两个完整服务端示例 | 临时纳入实际src编译通过，已移除临时文件 | `/tmp/data-table-b4-readme-build.log` |
| 最终完整 Playwright | **143/143，6.0m**，冻结文件后单独运行 | `/tmp/data-table-final-e2e.log` |
| 公开契约、文件范围和文档 | AST公开声明一致，barrel/types未改，白名单/本地链接/diff-check通过 | 执行清单最终记录 |

Browser plugin not available；使用仓库已有 Playwright 和系统Chrome 156.0.8078.79。生产性能为 Apple M3 Pro / darwin arm64，同机器、同构建脚本。完整E2E使用 `http://127.0.0.1:4173`，单worker，覆盖窄屏/桌面、明暗、RTL、键盘、200%缩放与实际交互；测试收集pageerror，未过滤ResizeObserver错误。日志中的动态导入失败属于ux-hardening既有故障注入测试，该用例通过。

本轮保留公开API、默认值、start/center/end列序、几何预算及辅助优先级；未修改ui/、后端、依赖或无关页面。主要变化为可读性、内部职责提取、线性几何偏移、导出流程拆分及测试/文档补全；修复原基线已复现的密度锚点缓存/定位问题。

范围与限制见 [组合矩阵](STABILITY_COMBINATIONS.md) 和 [性能记录](STABILITY_PERFORMANCE.md)。端到端性能有噪声，不能宣称整体提速；动态密度稳定性证据针对初次RO测量就绪后的切换。未验证滚动中尚在首次动态测量时切换、其他浏览器/低端设备、服务端或网络性能。没有为测试通过新增功能、提高阈值、更新截图或跳过既有用例。

截图证据保留于临时目录：生产虚拟分组表 `/tmp/infranexus-m5-table.png`、主题/缩放矩阵 `/tmp/infranexus-table-m6.png`；实际下载与行/表头坐标由浏览器断言验证。没有把生成产物加入仓库。
