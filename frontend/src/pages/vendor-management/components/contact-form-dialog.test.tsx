// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContactFormDialog } from "./contact-form-dialog"
import { contactsService } from "@/services/vendor-management"

vi.mock("@/services/vendor-management", () => ({
  contactsService: {
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

describe("ContactFormDialog with TanStack Form", () => {
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

  it("intercepts invalid short name and invalid email", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ContactFormDialog
            open={true}
            ownerType="vendor"
            ownerId="v-1"
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#contact-code") as HTMLInputElement
    const nameInput = document.querySelector("input#contact-name") as HTMLInputElement
    const emailInput = document.querySelector("input#contact-email") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(codeInput, "c-101")
      setInputValue(nameInput, "a")
      setInputValue(emailInput, "not-an-email")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(contactsService.create).not.toHaveBeenCalled()

    const nameError = document.querySelector("#contact-name-error")
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("姓名至少 2 个字符")

    const emailError = document.querySelector("#contact-email-error")
    expect(emailError).not.toBeNull()
    expect(emailError?.textContent).toContain("工作邮箱格式不正确")
  })

  it("submits valid contact and handles server error with auto-heal", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "code", tag: "unique", message: "人员编码已被占用" }],
        },
      },
    }

    vi.mocked(contactsService.create).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ContactFormDialog
            open={true}
            ownerType="vendor"
            ownerId="v-1"
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#contact-code") as HTMLInputElement
    const nameInput = document.querySelector("input#contact-name") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(codeInput, "c-zhangsan")
      setInputValue(nameInput, "张三")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(contactsService.create).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const codeError = document.querySelector("#contact-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("人员编码已被占用")

    // 修改后自愈
    await act(async () => {
      setInputValue(codeInput, "c-zhangsan-2")
    })

    expect(document.querySelector("#contact-code-error")).toBeNull()
  })
})
