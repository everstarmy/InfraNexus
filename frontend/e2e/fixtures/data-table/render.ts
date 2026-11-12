import { DataTableRowActions } from "../../../src/components/data-table/data-table-row-actions"
import { DataTableColumnHeader } from "../../../src/components/data-table/data-table-column-header"
import type { DateRange } from "react-day-picker"
import { emptyQuery } from "../../../src/components/data-table/data-table-query"
// Loaded by Vite only from the test harness, never imported by the application.
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DataTable, createSelectColumn, type ColumnDef } from '../../../src/components/data-table/data-table'
import { QueryErrorState } from '../../../src/components/common/query-error-state'
import { makeRows, scenarioRows, type FixtureOptions, type FixtureRow } from './data'

export function renderFixture(container: HTMLElement, options: FixtureOptions) {
  const scenario = options.scenario ?? 'short'
  const data = options.rowCount === undefined ? scenarioRows(scenario) : makeRows(options.rowCount)
  const columns: ColumnDef<FixtureRow>[] = [{
    accessorKey: 'name', header: options.advanced ? ({ column }) => h(DataTableColumnHeader, { column, title: '名称' }) : '名称',
    cell: scenario === 'tree' ? ({ row }) => h('div', null,
      row.getCanExpand() ? h('button', {
        type: 'button', 'aria-label': `展开${row.original.name}`,
        'aria-expanded': row.getIsExpanded(), onClick: row.getToggleExpandedHandler(),
      }, row.getIsExpanded() ? '收起' : '展开') : null,
      row.original.name,
    ) : ({ row }) => row.original.name,
  }]
  if (options.stabilityProbe) {
    columns.unshift(createSelectColumn<FixtureRow>())
    columns.push({ id: 'editor', header: '草稿', cell: ({ row }) => h('input', { 'aria-label': `草稿 ${row.id}`, defaultValue: row.original.name }) })
    columns.push({ id: 'actions', header: '操作', cell: ({ row }) => h(DataTableRowActions, { row: row.original, actions: [{ key: 'probe', label: '探针操作', onSelect: () => { container.dataset.action = 'yes' } }] }) })
  }
  if (options.advanced) columns.push({ accessorKey: 'description', header: ({ column }) => h(DataTableColumnHeader, { column, title: '说明' }) })
  if (scenario === 'long-text' || options.text) columns.push({ accessorKey: 'description', header: '说明', size: 240, meta: { text: options.text } })
  if (scenario === 'wide') {
    for (let index = 1; index <= 20; index++) columns.push({
      id: `extra-${index}`, header: `扩展字段 ${index}`,
      accessorFn: row => `${row.id} / 扩展内容 ${index}`,
    })
  }
  if (scenario === 'no-permission') {
    columns.unshift(createSelectColumn<FixtureRow>())
    columns.push({ id: 'actions', header: '操作', cell: ({ row }) => h('button', {
      type: 'button', disabled: !row.original.canEdit,
    }, '编辑') })
  }
  if (options.pinned) columns.push({ id: 'actions', header: '操作', size: 64, minSize: 64, maxSize: 64, cell: () => h('button', { type: 'button' }, '查看') })
  if (options.textValue !== undefined) data.forEach(row => { row.description = options.textValue! })
  const finalColumns: ColumnDef<FixtureRow>[] = options.grouped ? [{ id: 'group', header: '分组表头', columns }] : columns
  const heading = options.title === false ? undefined : h('h2', null, '验收表格')
  // Error ownership remains with the page/host, matching current production usage.
  function FixtureHost() {
    const [rows, setRows] = useState(data)
    const [viewKey, setViewKey] = useState('first')
    const [shown, setShown] = useState(true)
    const [pending, setPending] = useState(false)
    const [queryKey, setQueryKey] = useState('original')
    const [waitingRows, setWaitingRows] = useState(false)
    const [date, setDate] = useState<DateRange | undefined>({ from: new Date(2026, 9, 1) })
    const [query, setQuery] = useState(() => ({ ...emptyQuery(), sorts: [{ field: 'name', desc: false }], filter: { logic: 'and' as const, children: [{ field: 'date', op: 'eq' as const, value: '2026-10-28T08:00:00+08:00' }] } }))
    const [failed, setFailed] = useState(scenario === 'error')
    if (failed) return h('div', null, heading, h(QueryErrorState, {
      error: new Error('Synthetic fixture error'), label: '验收表格',
      onRetry: () => setFailed(false),
    }))
    const table = h(DataTable<FixtureRow>, {
      onRowClick: options.stabilityProbe ? () => { container.dataset.rowClicks = String(Number(container.dataset.rowClicks ?? 0) + 1) } : undefined,
      detail: options.details ? { render: row => h("div", null, `详情 ${row.name}`) } : undefined,
      groupBy: options.details ? { label: "分组", key: () => "示例组" } : undefined,
      virtualization: options.virtualized ? {} : undefined,
      isRefreshing: options.refreshing, error: options.tableError ? new Error("模拟查询失败") : undefined, onRetry: options.onRetry,
      columns: finalColumns, data: waitingRows ? [] : rows,
      viewport: options.viewport ? { ...options.viewport, queryKey, viewKey, pending } : undefined,
      layoutControls: options.controls === true ? { density: true, fullscreen: true, columns: true } : options.controls || undefined,
      enableColumnResizing: Boolean(options.pinned || options.text),
      enableColumnPinning: options.stickyOnly ? false : options.pinned,
      stickyActionColumn: options.pinned,
      initialColumnPinning: options.stickyOnly ? { start: ['extra-20'], end: [] } : options.pinned ? { start: ['name'], end: options.pinConflict ? ['extra-20'] : ['actions'] } : undefined,
      advancedQuery: options.advanced ? { value: query, fields: [{ key: 'date', label: '日期', type: 'date' }, { key: 'name', label: '名称', type: 'text', sortable: true }, { key: 'description', label: '说明', type: 'text', sortable: true }, { key: 'flag', label: '标记', type: 'boolean', nullable: true }, { key: 'kind', label: '类型', type: 'enum', nullable: true, options: [{ value: 1, label: '数字一' }, { value: '1', label: '文字一' }] }], onChange: next => { container.dataset.query = JSON.stringify(next); setQuery(next as typeof query) }, onResetFilters: next => { container.dataset.query = JSON.stringify(next); container.dataset.resets = String(Number(container.dataset.resets ?? 0) + 1); setQuery(next as typeof query) }, onApplyView: () => {} } : undefined,
      externalDateRange: options.externalDate ? { value: date, onChange: next => { setDate(next); container.dataset.date = next ? "set" : "cleared" }, title: "受控日期" } : undefined,
      defaultPageSize: options.pageSize,
      pageSizeOptions: options.pageSizeOptions,
      maxPageSize: options.maxPageSize,
      tablePreference: options.preference ? { userId: 'm1-reviewer', tableId: 'm1-fixture', schemaVersion: 1 } : undefined,
      getRowId: row => row.id,
      loading: scenario === 'loading' || waitingRows,
      selectionDisabled: scenario === 'no-permission',
      getSubRows: scenario === 'tree' ? row => row.children : undefined,
      defaultExpanded: scenario === 'tree' ? true : undefined,
      toolbarTitle: options.legacy ? undefined : heading,
      toolbarLeading: options.legacy ? heading : undefined,
      hideSearch: options.hideSearch, hideRefresh: options.hideRefresh,
      hideViewOptions: options.hideViewOptions,
      showViewOptions: options.showViewOptions ?? (options.legacy || options.pinned ? true : undefined),
      onRefresh: () => { container.dataset.refreshed = 'yes'; setRows(current => current.map(row => ({ ...row }))) },
      searchLeading: options.slots ? h('button', null, '前置筛选') : undefined,
      searchTrailing: options.slots ? h('button', null, '后置筛选') : undefined,
      emptyTitle: '夹具暂无数据',
    })
    if (!options.interactive && options.parentHeight === undefined) return table
    return h('div', { style: { height: options.parentHeight, display: 'flex', flexDirection: 'column', gap: 8 } },
      options.interactive ? h('div', { style: { flexShrink: 0 } },
        h('button', { onClick: () => setShown(value => !value) }, '挂载切换'),
        h('button', { onClick: () => setViewKey(value => value === 'first' ? 'second' : 'first') }, '切换视图'),
        h('button', { onClick: () => setRows(current => [{ ...makeRows(1, 'inserted')[0], name: '新增行' }, ...current]) }, '插入首行'),
        h('button', { onClick: () => { setPending(true); setQueryKey('next') } }, '开始异步查询'),
        h('button', { onClick: () => { setRows(makeRows(100, 'next')); setPending(false) } }, '完成异步查询'),
        h('button', { onClick: () => { setShown(true); setWaitingRows(true) } }, '返回加载中'),
        h('button', { onClick: () => setWaitingRows(false) }, '数据就绪'),
      ) : null,
      h('div', { style: { minHeight: 0, flex: 1 } }, shown ? table : h('p', null, '表格已卸载')),
    )
  }
  const root = createRoot(container)
  root.render(h(FixtureHost))
  return () => root.unmount()
}
