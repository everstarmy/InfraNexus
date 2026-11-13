// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ManufacturerFormDialog } from "./manufacturer-form-dialog"
import { manufacturersService } from "@/services/vendor-management"

vi.mock("@/services/vendor-management", () => ({
  manufacturersService: {
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock("@/hooks/use-unsaved-changes", () => ({
  useUnsavedChanges: vi.fn(),
}))

vi.mock("@/components/common/confirm-dialog", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}))

describe("ManufacturerFormDialog with TanStack Form", () => {
  let queryClient: QueryClient
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.clearAllMocks()
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

  const setInputValue = (el: HTMLInputElement, val: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    setter?.call(el, val)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  it("intercepts invalid regex pattern and invalid website URL", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ManufacturerFormDialog open={true} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#mfr-code") as HTMLInputElement
    const nameInput = document.querySelector("input#mfr-name") as HTMLInputElement
    const websiteInput = document.querySelector("input#mfr-website") as HTMLInputElement
    const patternInput = document.querySelector("input#mfr-serialNumberPattern") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(codeInput, "cisco")
      setInputValue(nameInput, "思科")
      setInputValue(websiteInput, "not-a-url")
      setInputValue(patternInput, "[invalid(regex")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(manufacturersService.create).not.toHaveBeenCalled()

    const websiteError = document.querySelector("#mfr-website-error")
    expect(websiteError).not.toBeNull()
    expect(websiteError?.textContent).toContain("官方网站必须为合法的 http(s) 链接")

    const patternError = document.querySelector("#mfr-serialNumberPattern-error")
    expect(patternError).not.toBeNull()
    expect(patternError?.textContent).toContain("序列号匹配规则必须为合法正则表达式")
  })

  it("submits valid manufacturer and handles 400001 code conflict with auto-heal", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "code", tag: "unique", message: "制造商编码已存在" }],
        },
      },
    }

    vi.mocked(manufacturersService.create).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ManufacturerFormDialog open={true} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#mfr-code") as HTMLInputElement
    const nameInput = document.querySelector("input#mfr-name") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(codeInput, "cisco")
      setInputValue(nameInput, "思科系统")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(manufacturersService.create).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const codeError = document.querySelector("#mfr-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("制造商编码已存在")

    // 修改后自愈
    await act(async () => {
      setInputValue(codeInput, "cisco-systems")
    })

    expect(document.querySelector("#mfr-code-error")).toBeNull()
  })
})
