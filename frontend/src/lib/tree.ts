export interface TreeLike<T> {
  id: string
  children?: T[] | null
}

export function flattenTree<T extends TreeLike<T>>(nodes: T[]): T[] {
  const out: T[] = []
  const walk = (list: T[]) => {
    for (const node of list) {
      out.push(node)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

export function findNode<T extends TreeLike<T>>(nodes: T[], id: string): T | undefined {
  return flattenTree(nodes).find((n) => n.id === id)
}

export function findPath<T extends TreeLike<T>>(nodes: T[], id: string): T[] {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const sub = findPath(node.children ?? [], id)
    if (sub.length) return [node, ...sub]
  }
  return []
}

export function collectIds<T extends TreeLike<T>>(node: T): string[] {
  return flattenTree([node]).map((n) => n.id)
}

export function filterTree<T extends TreeLike<T>>(nodes: T[], predicate: (node: T) => boolean): T[] {
  const out: T[] = []
  for (const node of nodes) {
    const children = filterTree(node.children ?? [], predicate)
    if (predicate(node) || children.length) out.push({ ...node, children })
  }
  return out
}
