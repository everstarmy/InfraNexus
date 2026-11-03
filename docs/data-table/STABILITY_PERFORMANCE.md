# DataTable 稳定性性能记录

2026-10-31，同一台 Apple M3 Pro / darwin arm64，Chrome 156.0.8078.79。起始 HEAD `9dfa36913743f35ebc6d523b056b2df02a2edf1e`。使用 `tsc -p tsconfig.table-perf.json && vite build --config vite.table-perf.config.ts` 生产构建，4175 preview，单 worker；每场景3次，操作类指标每次10次。首次沙箱 Chrome 启动 EPERM 后按正常 escalation 运行。

原矩阵基线在任何生产行为修改前采集，补充场景在 B2 等价提取后、B3 几何优化前采集；因此不能将补充场景差异归因于 B2 提取。前后都执行同样 fixture/构建脚本与浏览器。原始 JSON/日志保留在 `/tmp`，不是持久分发产物。最终构建包含几何优化及经验证的密度锚点修复。

命令：
```sh
PW_CHROME_CHANNEL=chrome TABLE_VIRTUAL=1 TABLE_PERF_REPORT=/tmp/data-table-stability-before.json npm --prefix frontend run test:table-perf
PW_CHROME_CHANNEL=chrome TABLE_STABILITY_REPORT=/tmp/data-table-stability-supplement-before.json npm --prefix frontend run test:table-perf -- --grep 'stability supplementary'
PW_CHROME_CHANNEL=chrome TABLE_VIRTUAL=1 TABLE_PERF_REPORT=/tmp/data-table-stability-after-final.json TABLE_STABILITY_REPORT=/tmp/data-table-stability-supplement-after-final.json npm --prefix frontend run test:table-perf
```

下表为中位数 [最小,最大]，单位 ms；不是后端性能或纯 JS 渲染耗时。startup 包含页面导航/首行可见，操作包含双 RAF；density 包含 Playwright 点击/状态检查与双 RAF，不可与纯帧延迟直接比较。

| 场景 | 指标 | 前 | 后 |
| --- | --- | --- | --- |
| 100行×20列 虚拟化 | startupMs | 67.0 [67.0,133.0] | 69.0 [66.0,125.0] |
| 100行×20列 虚拟化 | latency | 32.1 [22.9,33.4] | 32.0 [21.3,33.3] |
| 100行×20列 虚拟化 | viewLatency | 32.4 [31.3,33.3] | 31.8 [29.1,34.4] |
| 10000行×20列 虚拟化 | startupMs | 79.0 [75.0,82.0] | 82.0 [69.0,86.0] |
| 10000行×20列 虚拟化 | latency | 32.3 [25.9,33.3] | 32.1 [23.4,34.5] |
| 10000行×20列 虚拟化 | viewLatency | 32.1 [30.4,33.1] | 31.8 [29.8,34.0] |
| 100行×100列 虚拟化 | startupMs | 110.0 [102.0,127.0] | 98.0 [98.0,124.0] |
| 100行×100列 虚拟化 | latency | 33.3 [17.8,75.6] | 33.2 [16.7,51.0] |
| 100行×100列 虚拟化 | viewLatency | 32.5 [25.5,42.1] | 32.5 [26.9,36.3] |
| 5000行×20列 树形 | startupMs | 64.0 [63.0,73.0] | 71.0 [57.0,71.0] |
| 5000行×20列 树形 | latency | 32.3 [20.4,33.3] | 32.2 [22.1,34.0] |
| 5000行×20列 树形 | viewLatency | 32.2 [31.3,32.9] | 32.1 [29.4,34.5] |
| ordinary-page | startupMs | 54.0 [44.0,120.0] | 46.0 [46.0,104.0] |
| ordinary-page | refreshMs | 19.1 [18.9,25.4] | 19.0 [18.4,24.1] |
| ordinary-page | densityMs | 97.0 [94.0,97.0] | 97.0 [96.0,98.0] |
| complex-cells | startupMs | 65.0 [60.0,68.0] | 72.0 [63.0,74.0] |
| complex-cells | refreshMs | 29.4 [21.4,30.2] | 25.2 [22.5,32.9] |
| complex-cells | densityMs | 97.0 [96.0,98.0] | 97.0 [97.0,98.0] |
| density-refresh | startupMs | 62.0 [60.0,63.0] | 62.0 [61.0,63.0] |
| density-refresh | refreshMs | 19.0 [17.6,19.3] | 19.7 [17.0,21.1] |
| density-refresh | densityMs | 98.0 [97.0,98.0] | 96.0 [95.0,98.0] |

结果解读：核心偏移生成在实现上从逐列查找/切片/累加变为集合与前后缀单次遍历，O(C)。浏览器指标接近帧调度噪声范围，部分指标升、部分降，无法证明端到端稳定提速，也没有增加跨渲染缓存。最终原有200ms门槛全部通过，未提高阈值。宽表仍100列、没有列虚拟化。

原基线6/7通过，既有密度锚点失败已复现；最终9/9通过（17.2s）。密度新增动态场景明确等待初始RO行高/位置4帧稳定，保留原锚点、挂载数量和末行断言；扩大重复20/20通过（18.4s）。初始动态测量尚未完成时的密度切换不在该稳定性证据范围。未测网络、服务端、跨浏览器、低端设备和极端列数；CPU/heap没有前后定量对照，已有GC趋势门槛通过不等于无泄漏证明。

构建资产版本见 `/tmp/data-table-stability-before.log`（原矩阵）、`/tmp/data-table-supplement-before.log`（补充基线）和 `/tmp/data-table-b3-perf-final.log`（最终）；均来自上述HEAD及本轮未提交工作区，未伪造提交版本。
