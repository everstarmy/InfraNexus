import { describe, expect, it } from "vitest"
import { clearNodes, countSelected, indexPermissionTree, invertNodes, nodeState, selectNodes, summarizeSelection, toggleNode, type SelectableNode } from "./permission-selection"

const users: SelectableNode = {
  id: "users",
  children: [
    { id: "list" },
    { id: "create", children: [{ id: "create-api" }] },
  ],
}

describe("permission selection", () => {
  it("cascades a check to every descendant", () => {
    expect([...toggleNode(new Set(), users, true)].sort()).toEqual(["create", "create-api", "list", "users"])
    expect([...toggleNode(new Set(["users", "list", "create", "create-api"]), users.children![1], false)].sort()).toEqual(["list", "users"])
  })

  it("derives checked / indeterminate / unchecked states from the subtree", () => {
    expect(nodeState(new Set(["users", "list", "create", "create-api"]), users)).toBe("checked")
    expect(nodeState(new Set(["create-api"]), users)).toBe("indeterminate")
    expect(nodeState(new Set(["users"]), users)).toBe("indeterminate")
    expect(nodeState(new Set(), users)).toBe("unchecked")
  })

  it("supports module-level select all, invert and clear", () => {
    expect(countSelected(selectNodes(new Set(["other"]), users), users)).toEqual({ selected: 4, total: 4 })
    expect([...invertNodes(new Set(["list", "other"]), users)].sort()).toEqual(["create", "create-api", "other", "users"])
    expect([...clearNodes(new Set(["users", "list", "other"]), users)]).toEqual(["other"])
  })

  it("uses a tree index for tri-state summaries and only changes visible search results", () => {
    const visibleResults: SelectableNode = { id: "users", children: [users.children![1]] }
    const index = indexPermissionTree([visibleResults])
    const selected = new Set(["list"])
    const summary = summarizeSelection(selected, index)

    expect(summary.get("users")).toEqual({ selected: 0, total: 3, state: "unchecked" })
    expect([...toggleNode(selected, visibleResults, true, index)].sort()).toEqual(["create", "create-api", "list", "users"])
    expect([...clearNodes(new Set(["users", "list", "create", "create-api"]), visibleResults, index)]).toEqual(["list"])
    expect(nodeState(new Set(["create-api"]), visibleResults.children![0], index, summary)).toBe("unchecked")
    expect(countSelected(new Set(["users", "list", "create"]), visibleResults, index, summarizeSelection(new Set(["users", "list", "create"]), index))).toEqual({ selected: 2, total: 3 })
  })
})
