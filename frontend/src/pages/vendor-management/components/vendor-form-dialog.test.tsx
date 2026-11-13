// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VendorFormDialog } from "./vendor-form-dialog"
import { vendorsService } from "@/services/vendor-management"

vi.mock("@/services/vendor-management", () => ({
  vendorsService: {
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

describe("VendorFormDialog with TanStack Form", () => {
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

  it("intercepts invalid short code and short name before submitting", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <VendorFormDialog open={true} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#vendor-code") as HTMLInputElement
    const nameInput = document.querySelector("input#vendor-name") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(codeInput).not.toBeNull()
    expect(nameInput).not.toBeNull()

    await act(async () => {
      setInputValue(codeInput, "v")
      setInputValue(nameInput, "a")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(vendorsService.create).not.toHaveBeenCalled()

    const codeError = document.querySelector("#vendor-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("供应商编码至少 2 个字符")

    const nameError = document.querySelector("#vendor-name-error")
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("供应商全称至少 2 个字符")

    const creditError = document.querySelector("#vendor-creditCode-error")
    expect(creditError).not.toBeNull()
    expect(creditError?.textContent).toContain("统一社会信用代码必须为 18 位大写字母或数字")
  })

  it("submits valid vendor and handles 400001 snake_case field error with auto-heal", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "credit_code", tag: "unique", message: "统一社会信用代码已被注册" }],
        },
      },
    }

    vi.mocked(vendorsService.create).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <VendorFormDialog open={true} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#vendor-code") as HTMLInputElement
    const nameInput = document.querySelector("input#vendor-name") as HTMLInputElement
    const creditInput = document.querySelector("input#vendor-creditCode") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(codeInput, "vendor-dell")
      setInputValue(nameInput, "戴尔（中国）有限公司")
      setInputValue(creditInput, "91310000607200000X")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(vendorsService.create).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const creditError = document.querySelector("#vendor-creditCode-error")
    expect(creditError).not.toBeNull()
    expect(creditError?.textContent).toContain("统一社会信用代码已被注册")

    // 修改后错误自愈
    await act(async () => {
      setInputValue(creditInput, "91310000607200001Y")
    })

    expect(document.querySelector("#vendor-creditCode-error")).toBeNull()
  })
})
