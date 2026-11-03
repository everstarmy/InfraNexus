import { describe, expect, it } from "vitest"
import { hasPermission } from "./permissions"

describe("hasPermission", () => {
  it("grants everything to the wildcard", () => {
    expect(hasPermission(["*"], "users:create")).toBe(true)
  })

  it("requires the exact code and supports any-of lists", () => {
    expect(hasPermission(["users"], "users:create")).toBe(false)
    expect(hasPermission(["users"], ["roles", "users"])).toBe(true)
    expect(hasPermission(undefined, "users")).toBe(false)
    expect(hasPermission(["users"], [])).toBe(true)
  })
})
