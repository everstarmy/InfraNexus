# DataTable 组合契约与证据

2026-10-31。状态是现有契约，不代表新增功能。各测试入口见 [执行清单](STABILITY_EXECUTION_CHECKLIST.md)。

| 组合 | 契约与限制 | 实际测试 |
| --- | --- | --- |
| 虚拟化 × 行详情 | 既有回退到当前页完整 DOM；提示“行详情或行分组请使用分页模式”，数据仍在当前页模型，不自动扩大/截断页大小 | [兼容判断优先级](../../frontend/src/components/data-table/data-table-compatibility.test.ts)、[perf: virtual tree … unsupported details](../../frontend/perf/data-table.spec.ts) |
| 虚拟化 × 平面 groupBy | 同上回退；树形 getSubRows 与 groupBy 同传时忽略平面分组，保留树顺序 | [兼容判断](../../frontend/src/components/data-table/data-table-compatibility.test.ts)、[真实分组/树模型导出](../../frontend/src/components/data-table/data-table-clipboard-model.test.tsx) |
| 虚拟化 × 树形 | 条件支持：稳定 getRowId、限高/fill；当前页展开后模型参与虚拟化，展开/收起保留总行数契约 | [perf: virtual tree expands and collapses](../../frontend/perf/data-table.spec.ts)、[baseline tree](../../frontend/e2e/data-table-baseline.spec.ts) |
| 虚拟化 × mobileContent | max-height + mobileContent 回退并提示固定高度要求；fill（含全屏）绕过该 max-height 检查，保持原优先级 | [兼容判断含同时失配优先级](../../frontend/src/components/data-table/data-table-compatibility.test.ts) |
| 虚拟化 × 手动兼容分页 | 可切换；进入兼容模式将页大小约束为100，退出保持当前页大小；不自动扩张回万行，未删除其他页数据 | [perf: virtual rows … compatibility](../../frontend/perf/data-table.spec.ts)、[页大小实现](../../frontend/src/components/data-table/data-table.tsx) |
| 固定 × 显隐/重排/调宽 | 支持；start/center/end 顺序、单一伸展列、辅助列优先级、窄屏宽度预算不变；stickyActionColumn 单独开启仍自然布局 | [layout: pinned columns survive resizing/hiding](../../frontend/e2e/data-table-layout.spec.ts)、[几何矩阵及旧算法对照](../../frontend/src/components/data-table/data-table-geometry.test.ts)、[preferences 列迁移](../../frontend/src/components/data-table/use-column-preferences.test.tsx) |
| 受控选择 × 翻页/筛选/刷新 | 宿主拥有跨页描述符，组件只投影当前页；查询范围变化由宿主清除，刷新不伪造全量选择 | [M3 跨页/排除/失败重试](../../frontend/e2e/data-table-m3.spec.ts)、[选择纯函数](../../frontend/src/components/data-table/data-table-selection.test.ts)、[更新/行事件隔离](../../frontend/e2e/data-table-stability.spec.ts) |
| 视图恢复 × 列变更 | 条件支持：同用户/表/schema作用域，未知列过滤、尺寸和固定状态白名单迁移；恢复不是服务端授权 | [偏好 Hook](../../frontend/src/components/data-table/use-column-preferences.test.tsx)、[偏好/视图边界](../../frontend/src/components/data-table/data-table-query.test.ts)、[存储不可用](../../frontend/e2e/data-table-release.spec.ts) |
| 密度 × 动态高度/锚点 | 条件支持：初始动态测量就绪后切换密度；先重建测量/偏移，定位原 ID，新范围提交后一次性恢复像素偏移并结束滚动命令。虚拟容器由虚拟器负责锚点；挂载行数有界，末行可达。滚动中尚未完成初次测量时的切换不在该稳定性证据内 | [perf: density changes … / dynamic height](../../frontend/perf/data-table.spec.ts) |
| 更新 × 输入/菜单/详情/虚拟焦点 | 不重挂载相同行控件，菜单与草稿保留；虚拟 ref/data-index/aria-rowindex 仍在数据 tr；焦点行跨滚动保留 | [稳定性浏览器](../../frontend/e2e/data-table-stability.spec.ts)、[perf: virtual rows … focus](../../frontend/perf/data-table.spec.ts) |

不支持的组合不强行启用。公开接口没有新增 ID 校验：稳定 ID 的前提仍由调用方保证，兼容判断检测是否提供 getRowId，不尝试重写重复/空业务 ID。
