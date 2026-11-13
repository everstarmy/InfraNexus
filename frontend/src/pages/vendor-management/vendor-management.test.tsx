// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { companiesService, type CompanyDTO } from "@/services/vendor-management"
import VendorManagementPage from "./index"

vi.mock("@/services/vendor-management", () => ({
  companiesService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
    history: vi.fn(),
    references: vi.fn(),
  },
  companyContactsService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
    history: vi.fn(),
    references: vi.fn(),
  },
}))

vi.mock("@/stores/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u-1" },
    can: () => true,
  }),
}))

vi.mock("@/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}))

vi.mock("@/hooks/use-unsaved-changes", () => ({
  useUnsavedChanges: vi.fn(),
}))

vi.mock("@/lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock("@/components/common/confirm-dialog", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}))

describe("VendorManagementPage", () => {
  let queryClient: QueryClient
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  const sampleCompanies: CompanyDTO[] = [
    {
      id: "1",
      name: "华为技术有限公司",
      type: 3,
      short_name: "华为",
      english_name: "Huawei",
      website: "https://www.huawei.com",
      status: 1,
      version: 1,
      created_at: "2026-11-13T00:00:00Z",
      updated_at: "2026-11-13T00:00:00Z",
    },
    {
      id: "2",
      name: "星河硬件原厂",
      type: 1,
      status: 1,
      version: 1,
      created_at: "2026-11-13T00:00:00Z",
      updated_at: "2026-11-13T00:00:00Z",
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(companiesService.list).mockResolvedValue({
      code: 200000,
      message: "ok",
      request_id: "req-1",
      data: {
        items: sampleCompanies,
        total: 2,
        page: 1,
        page_size: 20,
      },
    })
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
  })

  it("renders a single unified table with search, type filters, and two-column create dialog", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <VendorManagementPage />
          </TooltipProvider>
        </QueryClientProvider>,
      )
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    // No tabs — single unified table
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0)

    // Both rows rendered, type=3 displays both badges
    expect(document.body.textContent).toContain("华为技术有限公司")
    expect(document.body.textContent).toContain("星河硬件原厂")

    // Single primary create button
    const createButtons = Array.from(document.querySelectorAll("button")).filter((btn) =>
      btn.textContent?.includes("新建厂商"),
    )
    expect(createButtons).toHaveLength(1)

    // Click type filter "制造商" -> sends type=1
    const filterGroup = document.querySelector('[aria-label="按厂商类型过滤"]')!
    const mfrBtn = Array.from(filterGroup.querySelectorAll("button")).find(
      (btn) => btn.textContent === "制造商",
    )!
    await act(async () => {
      mfrBtn.click()
    })
    expect(companiesService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 1, page: 1 }),
      expect.any(AbortSignal),
    )

    // Search by name -> sends search param
    const searchInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="搜索厂商名称…"]',
    )!
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set
    await act(async () => {
      setter?.call(searchInput, "华为")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(companiesService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "华为", type: 1, page: 1 }),
      expect.any(AbortSignal),
    )

    // Open create dialog -> displays two-column form and checkbox type choices
    await act(async () => {
      createButtons[0].click()
    })
    expect(document.body.textContent).toContain("新建厂商档案")
    expect(document.body.textContent).toContain("硬件制造商")
    expect(document.body.textContent).toContain("供应商 / 服务商")
    expect(document.querySelectorAll('[role="checkbox"]').length).toBe(2)
  })
})
