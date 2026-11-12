// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ManagedLookup, type ManagedLookupSource } from "./managed-editor"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock("@/stores/auth-context", () => ({
  useAuth: () => ({
    user: { id: "1", username: "admin", nickname: "管理员", role_code: "admin", permissions: ["*"] },
    can: () => true,
    loading: false,
  }),
}))

describe("ManagedLookup component", () => {
  const dummySource: ManagedLookupSource = {
    key: "networkScopes",
    permission: "ipam:network-scopes:read",
    list: vi.fn().mockResolvedValue({
      code: 200000,
      message: "OK",
      data: {
        items: [
          { id: "scope-1", name: "生产地址空间" },
          { id: "scope-2", name: "办公地址空间" },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      },
    }),
  }

  async function renderWithProviders(ui: React.ReactNode) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          {ui}
        </QueryClientProvider>,
      )
    })
    return {
      host,
      cleanup: () => {
        act(() => root.unmount())
        host.remove()
      },
    }
  }

  it("renders a compact single-line Trigger button without an external search input", async () => {
    const onChange = vi.fn()
    const { host, cleanup } = await renderWithProviders(
      <ManagedLookup
        id="subnet-scope"
        label="地址空间"
        value=""
        onChange={onChange}
        source={dummySource}
      />,
    )

    // 不应在常驻 DOM 中暴露裸露的搜索输入框
    const externalSearchInput = host.querySelector('input[type="search"]')
    expect(externalSearchInput).toBeNull()

    // 应该渲染一个标准的下拉按钮 Trigger
    const trigger = host.querySelector("button")
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain("选择地址空间")

    // 应包含一个支持测试与表单的关联隐藏 select
    const hiddenSelect = host.querySelector('select#subnet-scope') as HTMLSelectElement
    expect(hiddenSelect).not.toBeNull()
    expect(hiddenSelect.classList.contains("sr-only")).toBe(true)

    cleanup()
  })

  it("displays the selected value correctly and updates through select change", async () => {
    const onChange = vi.fn()
    const { host, cleanup } = await renderWithProviders(
      <ManagedLookup
        id="subnet-scope"
        label="地址空间"
        value="scope-1"
        onChange={onChange}
        source={dummySource}
      />,
    )

    // 等待异步数据加载并填入 options
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const hiddenSelect = host.querySelector('select#subnet-scope') as HTMLSelectElement
    expect(hiddenSelect.value).toBe("scope-1")

    await act(async () => {
      hiddenSelect.value = "scope-2"
      hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith("scope-2")
    cleanup()
  })
})
