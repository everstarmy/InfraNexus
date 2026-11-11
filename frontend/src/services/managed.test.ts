// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { api } from "./api"
import { createManagedClient, type ManagedBase } from "./managed"

interface MockEntity extends ManagedBase {
  extra: string
}

describe("createManagedClient", () => {
  const client = createManagedClient<MockEntity>("/test-resource")

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("calls list with query parameters and signal", async () => {
    const spy = vi.spyOn(api, "get").mockResolvedValueOnce({
      code: 200000,
      message: "success",
      data: { items: [], total: 0, page: 1, page_size: 20 },
      request_id: "req-1",
    } as any)

    const controller = new AbortController()
    const res = await client.list({ page: 1, page_size: 20, search: "demo" }, controller.signal)

    expect(spy).toHaveBeenCalledWith("/test-resource", {
      params: { page: 1, page_size: 20, search: "demo" },
      signal: controller.signal,
    })
    expect(res.data.items).toEqual([])
  })

  it("calls create with idempotency key header when provided", async () => {
    const spy = vi.spyOn(api, "post").mockResolvedValueOnce({
      code: 200000,
      message: "success",
      data: { id: "123", code: "demo", name: "Demo" },
      request_id: "req-2",
    } as any)

    await client.create({ code: "demo", name: "Demo", extra: "test" }, "idem-key-1")

    expect(spy).toHaveBeenCalledWith(
      "/test-resource",
      { code: "demo", name: "Demo", extra: "test" },
      { headers: { "Idempotency-Key": "idem-key-1" } }
    )
  })

  it("preserves existing fields when replacing a record", async () => {
    const spy = vi.spyOn(api, "put").mockResolvedValueOnce({
      code: 200000,
      message: "success",
      data: { id: "123", code: "demo", name: "Updated", version: 2 },
      request_id: "req-3",
    } as any)

    await client.update(
      { id: "123", code: "demo", name: "Original", version: 1, status: 1, extra: "keep", created_at: "", updated_at: "" },
      { name: "Updated" },
    )

    expect(spy).toHaveBeenCalledWith("/test-resource/123", {
      expected_version: 1,
      data: { code: "demo", name: "Updated", extra: "keep" },
    })
  })

  it("calls setStatus with expected_version and status", async () => {
    const spy = vi.spyOn(api, "patch").mockResolvedValueOnce({
      code: 200000,
      message: "success",
      data: { id: "123", status: 2, version: 2 },
      request_id: "req-4",
    } as any)

    await client.setStatus("123", 1, 2)

    expect(spy).toHaveBeenCalledWith("/test-resource/123/status", {
      expected_version: 1,
      status: 2,
    })
  })

  it("calls remove with expected_version in query params", async () => {
    const spy = vi.spyOn(api, "delete").mockResolvedValueOnce({
      code: 200000,
      message: "success",
      data: { deleted: true },
      request_id: "req-5",
    } as any)

    await client.remove("123", 1)

    expect(spy).toHaveBeenCalledWith("/test-resource/123", {
      params: { expected_version: 1 },
    })
  })
})
