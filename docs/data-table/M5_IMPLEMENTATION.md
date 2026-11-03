# M5：性能与按需行虚拟化

实施日期：2026-10-29。授权范围仅为 data-table M5；不新增后端能力，不启动 M6 页面迁移。

## 启用方式

默认继续使用已有分页与完整当前页 DOM。需要连续浏览大量本地行时显式启用：

```tsx
<DataTable
  columns={columns}
  data={rows}
  getRowId={row => row.id}
  defaultPageSize={10000}
  viewport={{ mode: "max-height", maxHeight: 520, restoreKey: "actor:table" }}
  virtualization={{ estimateRowHeight: 44, overscan: 6 }}
/>
```

- `virtualization` 缺省关闭；传 `{}` 使用默认估算高度 44px、overscan 6。overscan 限定为 1–20，高度估算限定为 24–500px，非有限值回退默认。
- 实际挂载行通过 ResizeObserver 测量，支持换行文本、密度和列宽改变。估算不限制真实行高。
- 只裁剪 TanStack **当前页展开后的行模型**，不改变筛选、排序、分页、选中、聚合或导出范围。树节点数量与根节点分页语义保持一致。
- 必须使用稳定且唯一的业务 `getRowId`。要求 `fill` 或有效 `max-height`；`mobileContent` 不可同时开启。普通业务页无需为了虚拟化增大分页。
- 新增依赖 `@tanstack/react-virtual`；采用其尺寸测量、overscan、稳定 key 与滚动 API，接口依据 [官方 Virtualizer 文档](https://tanstack.com/virtual/latest/docs/api/virtualizer)。

## 兼容与降级

| 组合 | 行为 |
| --- | --- |
| 树展开、根节点分页 | 支持，对展开后的顺序窗口化；收起仍走已有树模型 |
| 动态行高、固定表头、左右固定列、分组表头 | 保留原生 table 结构；虚拟正文使用隐藏占位行，不将表格改成 grid |
| Shift 连选、全选当前页 | 按完整当前页行模型选择，包含尚未挂载的行 |
| 聚合页脚 | 使用完整当前页，页脚不参与窗口化，计入 ARIA 行数 |
| 行详情 `detail`、行分组 `groupBy` | 明确提示并回退完整当前页模式；建议保持每页 100 行以内 |
| 无稳定 ID、自然高度、移动端取消高度限制 | 明确提示不启用虚拟滚动 |
| 键盘焦点 | 保留焦点行及相邻行；行被筛掉时焦点移到滚动区 |
| 辅助技术 | 提供当前页总行数、行序号、隐藏占位行；“分页兼容模式”关闭窗口化并将页大小降到最多 100 |
| 查找、打印、浏览器原生全文复制 | 虚拟模式只存在可见 DOM，应使用分页兼容模式或既有完整数据导出 |

兼容模式属于当前组件实例状态，不写入用户偏好。切回虚拟模式保留当前分页大小，不自动恢复 10,000 行。动态高度下跳转使用估算再测量校正，不承诺平滑滚动；跨卸载只恢复 ID/偏移，未挂载行的历史尺寸不持久化。

## 渲染、缓存与恢复

1. schema 与当前页分组结果按输入 memo；滚动锚点定位从逐行测量改为对有序 DOM 行二分查找。
2. 虚拟滚动订阅放在独立正文组件，滚动不重新执行整表工具栏渲染。
3. 尺寸缓存以 ID 为键。历史 ID 集合超过 `max(100, 当前行数 × 2)` 时调用公开 `measure()` 清空并重测挂载行；卸载释放观察器与虚拟器。仍需 O(N) 的客户端行模型，虚拟化不是服务端分页的替代品。
4. 保留原有最多 30 项、只保存位置元数据的返回位置缓存。`restoreKey` 由调用者包含用户/表格边界。
5. 动态高度测量时补偿底部位置，保证直接跳至末尾可见最后一行。恢复使用一次性偏移定位，不持续覆盖用户后续滚动。
6. 显式绑定滚动 DOM 后恢复位置，防止虚拟器初始化偏移覆盖返回位置。正文 DOM 变化和滚动后下一帧记录实际可见锚点；卸载取消帧任务及观察器。
7. 同查询插入数据优先按稳定 ID 恢复；已提交查询、分页和视图变化继续遵循 M1 的纵向/双轴重置规则。

## 列虚拟化暂缓

100×100 的原始采样交互 p95 为 187.4ms，行虚拟化后进一步降低到几十毫秒，DOM 也降至约两千个。当前没有证明需要额外引入列虚拟化。保留完整列 DOM，避免增加固定列、分组表头、Tab 顺序和辅助技术的兼容复杂度。真实超宽业务页超预算后再单独评估，DT-504 保持暂缓。

## 运行与隔离

```sh
cd frontend
# 当前实现（普通模式）四组样本
PW_CHROME_CHANNEL=chrome npm run test:table-perf
# 虚拟模式及相同功能回归
PW_CHROME_CHANNEL=chrome TABLE_VIRTUAL=1 npm run test:table-perf
```

`vite.table-perf.config.ts` 单独构建到被 Git 忽略的 `dist-table-perf/`，4175 端口运行，产物不进入正常 `npm run build`。脚本先对夹具与测试执行 TypeScript 检查。`TABLE_PERF_REPORT` 可指定 JSON 结果路径；默认 `/tmp/data-table-baseline.json`。数据完全本地生成，没有 API 请求，不能据此宣称后端性能提升。固定基线结果与预算见 [M5 验收](M5_VALIDATION.md)。
