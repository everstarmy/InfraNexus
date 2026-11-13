// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DepartmentFormDialog } from "./department-form-dialog"
import { departmentsService } from "@/services/departments"

vi.mock("@/services/departments", () => ({
  departmentsService: {
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

describe("DepartmentFormDialog with TanStack Form", () => {
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

  it("intercepts invalid code and empty name on frontend", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DepartmentFormDialog
            open={true}
            onOpenChange={vi.fn()}
            departments={[]}
            treeRevision={1}
          />
        </QueryClientProvider>,
      )
    })

    const nameInput = document.querySelector("input#dept-name") as HTMLInputElement
    const codeInput = document.querySelector("input#dept-code") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(nameInput).not.toBeNull()
    expect(codeInput).not.toBeNull()

    // 填入非法部门编码（数字开头）
    await act(async () => {
      setInputValue(nameInput, "")
      setInputValue(codeInput, "123invalid")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(departmentsService.create).not.toHaveBeenCalled()

    const nameError = document.querySelector("#dept-name-error")
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("请输入有效的部门名称")

    const codeError = document.querySelector("#dept-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("以字母开头")
  })

  it("submits valid form and handles server 400001 code conflict with auto-heal", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "code", tag: "unique", message: "部门编码已被占用" }],
        },
      },
    }

    vi.mocked(departmentsService.create).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DepartmentFormDialog
            open={true}
            onOpenChange={vi.fn()}
            departments={[]}
            treeRevision={1}
          />
        </QueryClientProvider>,
      )
    })

    const nameInput = document.querySelector("input#dept-name") as HTMLInputElement
    const codeInput = document.querySelector("input#dept-code") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(nameInput, "安全运营中心")
      setInputValue(codeInput, "sec-ops")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(departmentsService.create).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const codeError = document.querySelector("#dept-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("部门编码已被占用")

    // 修改编码后错误自愈
    await act(async () => {
      setInputValue(codeInput, "sec-ops-2")
    })

    expect(document.querySelector("#dept-code-error")).toBeNull()
  })
})
