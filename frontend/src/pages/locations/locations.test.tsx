// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { formatFloor, formatRackPosition, locationTypeLabels } from "./components/location-tree"
import type { LocationNode, LocationType, RackExt, RoomExt } from "@/services/locations"

vi.mock("@/lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe("Location hierarchy & formatters", () => {
  it("formats floor numbers correctly for ground and basement floors", () => {
    expect(formatFloor(1)).toBe("1F")
    expect(formatFloor(3)).toBe("3F")
    expect(formatFloor(100)).toBe("100F")
    expect(formatFloor(0)).toBe("0F")
    expect(formatFloor(-1)).toBe("B1F")
    expect(formatFloor(-3)).toBe("B3F")
    expect(formatFloor(-5)).toBe("B5F")
    expect(formatFloor(null)).toBe("")
    expect(formatFloor(undefined)).toBe("")
  })

  it("formats rack row and column coordinates correctly", () => {
    expect(formatRackPosition({ row: "A", column: 1 })).toBe("A-01")
    expect(formatRackPosition({ row: "B", column: 12 })).toBe("B-12")
    expect(formatRackPosition({ row: "25", column: 5 })).toBe("25-05")
    expect(formatRackPosition({ row: "C" })).toBe("C排")
    expect(formatRackPosition({})).toBe("")
    expect(formatRackPosition(undefined)).toBe("")
  })

  it("defines standard Chinese labels for all 4 spatial hierarchy levels", () => {
    expect(locationTypeLabels.datacenter).toBe("数据中心")
    expect(locationTypeLabels.building).toBe("楼栋")
    expect(locationTypeLabels.room).toBe("机房")
    expect(locationTypeLabels.rack).toBe("机柜")
  })

  it("strictly enforces 4-tier spatial hierarchy relationships", () => {
    const parentTypes: Record<LocationType, LocationType | null> = {
      datacenter: null,
      building: "datacenter",
      room: "building",
      rack: "room",
    }
    const childTypes: Record<LocationType, LocationType | null> = {
      datacenter: "building",
      building: "room",
      room: "rack",
      rack: null,
    }

    expect(parentTypes.datacenter).toBeNull()
    expect(parentTypes.building).toBe("datacenter")
    expect(parentTypes.room).toBe("building")
    expect(parentTypes.rack).toBe("room")

    expect(childTypes.datacenter).toBe("building")
    expect(childTypes.building).toBe("room")
    expect(childTypes.room).toBe("rack")
    expect(childTypes.rack).toBeNull()
  })

  it("validates rack row specification format (A-Z or 1-25)", () => {
    const ROW_PATTERN = /^(?:[A-Za-z]|[1-9]|1[0-9]|2[0-5])$/
    expect(ROW_PATTERN.test("A")).toBe(true)
    expect(ROW_PATTERN.test("z")).toBe(true)
    expect(ROW_PATTERN.test("1")).toBe(true)
    expect(ROW_PATTERN.test("25")).toBe(true)

    expect(ROW_PATTERN.test("AA")).toBe(false)
    expect(ROW_PATTERN.test("0")).toBe(false)
    expect(ROW_PATTERN.test("26")).toBe(false)
    expect(ROW_PATTERN.test("A1")).toBe(false)
    expect(ROW_PATTERN.test("")).toBe(false)
  })

  it("validates room floor boundary values (-5 to 100)", () => {
    const isValidFloor = (f: number) => Number.isInteger(f) && f >= -5 && f <= 100
    expect(isValidFloor(-5)).toBe(true)
    expect(isValidFloor(0)).toBe(true)
    expect(isValidFloor(100)).toBe(true)
    expect(isValidFloor(-6)).toBe(false)
    expect(isValidFloor(101)).toBe(false)
    expect(isValidFloor(3.5)).toBe(false)
  })

  it("validates rack height U boundary values (1 to 100, default 42)", () => {
    const isValidHeight = (h: number) => Number.isInteger(h) && h >= 1 && h <= 100
    expect(isValidHeight(42)).toBe(true)
    expect(isValidHeight(1)).toBe(true)
    expect(isValidHeight(100)).toBe(true)
    expect(isValidHeight(0)).toBe(false)
    expect(isValidHeight(101)).toBe(false)
  })

  it("validates rack column boundary values (1 to 9999)", () => {
    const isValidColumn = (c: number) => Number.isInteger(c) && c >= 1 && c <= 9999
    expect(isValidColumn(1)).toBe(true)
    expect(isValidColumn(9999)).toBe(true)
    expect(isValidColumn(0)).toBe(false)
    expect(isValidColumn(10000)).toBe(false)
  })
})
