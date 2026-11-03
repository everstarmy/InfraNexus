import { describe, expect, it } from "vitest"
import { collectIds, filterTree, findNode, findPath, flattenTree } from "./tree"

interface Node {
  id: string
  name: string
  children?: Node[]
}

const tree: Node[] = [
  { id: "a", name: "总部", children: [{ id: "b", name: "研发", children: [{ id: "c", name: "平台组" }] }, { id: "d", name: "财务" }] },
  { id: "e", name: "销售" },
]

describe("tree helpers", () => {
  it("flattens depth-first in display order", () => {
    expect(flattenTree(tree).map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"])
  })

  it("finds nodes and their ancestor path", () => {
    expect(findNode(tree, "c")?.name).toBe("平台组")
    expect(findPath(tree, "c").map((n) => n.id)).toEqual(["a", "b", "c"])
    expect(findPath(tree, "zzz")).toEqual([])
  })

  it("collects a node with all descendants", () => {
    expect(collectIds(findNode(tree, "b")!)).toEqual(["b", "c"])
  })

  it("filters while keeping ancestors of matches", () => {
    const filtered = filterTree(tree, (n) => n.name.includes("平台"))
    expect(flattenTree(filtered).map((n) => n.id)).toEqual(["a", "b", "c"])
  })
})
