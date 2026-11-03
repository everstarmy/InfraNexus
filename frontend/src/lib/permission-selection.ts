export interface SelectableNode {
  id: string
  children?: SelectableNode[] | null
}

export type CheckState = "checked" | "indeterminate" | "unchecked"

export interface PermissionTreeIndex {
  idsByNode: Map<string, string[]>
  postOrder: SelectableNode[]
}

export interface PermissionSelectionSummary {
  selected: number
  total: number
  state: CheckState
}

export function indexPermissionTree(nodes: SelectableNode[]): PermissionTreeIndex {
  const idsByNode = new Map<string, string[]>()
  const postOrder: SelectableNode[] = []
  const visit = (node: SelectableNode): string[] => {
    const ids = [node.id]
    for (const child of node.children ?? []) ids.push(...visit(child))
    idsByNode.set(node.id, ids)
    postOrder.push(node)
    return ids
  }
  nodes.forEach(visit)
  return { idsByNode, postOrder }
}

export function summarizeSelection(selected: ReadonlySet<string>, index: PermissionTreeIndex) {
  const summaries = new Map<string, PermissionSelectionSummary>()
  for (const node of index.postOrder) {
    const children = node.children ?? []
    const selectedCount = (selected.has(node.id) ? 1 : 0) + children.reduce((sum, child) => sum + (summaries.get(child.id)?.selected ?? 0), 0)
    const total = 1 + children.reduce((sum, child) => sum + (summaries.get(child.id)?.total ?? 0), 0)
    summaries.set(node.id, {
      selected: selectedCount,
      total,
      state: selectedCount === 0 ? "unchecked" : selectedCount === total ? "checked" : "indeterminate",
    })
  }
  return summaries
}

function subtreeIds(node: SelectableNode): string[] {
  const ids = [node.id]
  for (const child of node.children ?? []) ids.push(...subtreeIds(child))
  return ids
}

export function toggleNode(selected: ReadonlySet<string>, node: SelectableNode, checked: boolean, index?: PermissionTreeIndex) {
  const next = new Set(selected)
  for (const id of index?.idsByNode.get(node.id) ?? subtreeIds(node)) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}

export function nodeState(selected: ReadonlySet<string>, node: SelectableNode, index?: PermissionTreeIndex, summaries?: ReadonlyMap<string, PermissionSelectionSummary>): CheckState {
  const summary = summaries?.get(node.id)
  if (summary) return summary.state
  if (index) {
    const ids = index.idsByNode.get(node.id)
    if (ids) {
      const hits = ids.filter((id) => selected.has(id)).length
      return hits === 0 ? "unchecked" : hits === ids.length ? "checked" : "indeterminate"
    }
  }
  const ids = subtreeIds(node)
  const hits = ids.filter((id) => selected.has(id)).length
  if (hits === 0) return "unchecked"
  return hits === ids.length ? "checked" : "indeterminate"
}

export function selectNodes(selected: ReadonlySet<string>, node: SelectableNode, index?: PermissionTreeIndex) {
  return toggleNode(selected, node, true, index)
}

export function clearNodes(selected: ReadonlySet<string>, node: SelectableNode, index?: PermissionTreeIndex) {
  return toggleNode(selected, node, false, index)
}

export function invertNodes(selected: ReadonlySet<string>, node: SelectableNode, index?: PermissionTreeIndex) {
  const next = new Set(selected)
  for (const id of index?.idsByNode.get(node.id) ?? subtreeIds(node)) {
    if (next.has(id)) next.delete(id)
    else next.add(id)
  }
  return next
}

export function countSelected(selected: ReadonlySet<string>, node: SelectableNode, index?: PermissionTreeIndex, summaries?: ReadonlyMap<string, PermissionSelectionSummary>) {
  const summary = summaries?.get(node.id)
  if (summary) return { selected: summary.selected, total: summary.total }
  const ids = index?.idsByNode.get(node.id) ?? subtreeIds(node)
  return { selected: ids.filter((id) => selected.has(id)).length, total: ids.length }
}
