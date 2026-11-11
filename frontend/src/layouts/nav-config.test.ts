import { describe, expect, it } from "vitest"
import { findNavByPath, navGroups } from "./nav-config"

describe("Navigation Route Config and Highlighting", () => {
  it("resolves exact matches for location routes independently", () => {
    // 1. /locations/topology should resolve to "空间拓扑与机柜"
    const topologyNav = findNavByPath("/locations/topology")
    expect(topologyNav).toBeDefined()
    expect(topologyNav?.item.title).toBe("空间拓扑与机柜")
    expect(topologyNav?.item.url).toBe("/locations/topology")
    expect(topologyNav?.parent?.title).toBe("位置管理")

    // 2. /locations/warehouses should resolve to "备件仓储与暂存", NOT "空间拓扑与机柜"
    const warehouseNav = findNavByPath("/locations/warehouses")
    expect(warehouseNav).toBeDefined()
    expect(warehouseNav?.item.title).toBe("备件仓储与暂存")
    expect(warehouseNav?.item.url).toBe("/locations/warehouses")
    expect(warehouseNav?.parent?.title).toBe("位置管理")
  })

  it("normalizes /locations to /locations/topology", () => {
    const rootLocationNav = findNavByPath("/locations")
    expect(rootLocationNav).toBeDefined()
    expect(rootLocationNav?.item.title).toBe("空间拓扑与机柜")
    expect(rootLocationNav?.item.url).toBe("/locations/topology")
  })

  it("correctly identifies sub-path under /locations/warehouses", () => {
    const subWarehouse = findNavByPath("/locations/warehouses/bins")
    expect(subWarehouse).toBeDefined()
    expect(subWarehouse?.item.title).toBe("备件仓储与暂存")
  })

  it("resolves other independent groups without overlap", () => {
    expect(findNavByPath("/users")?.item.title).toBe("用户管理")
    expect(findNavByPath("/departments")?.item.title).toBe("部门管理")
    expect(findNavByPath("/roles")?.item.title).toBe("角色管理")
    expect(findNavByPath("/permissions")?.item.title).toBe("权限清单")
  })
})
