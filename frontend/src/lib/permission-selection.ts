export interface SelectableNode {
  id: string
  children?: SelectableNode[] | null
}

export type CheckState = "checked" | "indeterminate" | "unchecked"

function subtreeIds(node: SelectableNode): string[] {
  const ids = [node.id]
  for (const child of node.children ?? []) ids.push(...subtreeIds(child))
  return ids
}

export function toggleNode(selected: ReadonlySet<string>, node: SelectableNode, checked: boolean) {
  const next = new Set(selected)
  for (const id of subtreeIds(node)) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}

export function nodeState(selected: ReadonlySet<string>, node: SelectableNode): CheckState {
  const ids = subtreeIds(node)
  const hits = ids.filter((id) => selected.has(id)).length
  if (hits === 0) return "unchecked"
  return hits === ids.length ? "checked" : "indeterminate"
}

export function selectNodes(selected: ReadonlySet<string>, node: SelectableNode) {
  return toggleNode(selected, node, true)
}

export function clearNodes(selected: ReadonlySet<string>, node: SelectableNode) {
  return toggleNode(selected, node, false)
}

export function invertNodes(selected: ReadonlySet<string>, node: SelectableNode) {
  const next = new Set(selected)
  for (const id of subtreeIds(node)) {
    if (next.has(id)) next.delete(id)
    else next.add(id)
  }
  return next
}

export function countSelected(selected: ReadonlySet<string>, node: SelectableNode) {
  const ids = subtreeIds(node)
  return { selected: ids.filter((id) => selected.has(id)).length, total: ids.length }
}
