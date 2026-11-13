// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RoleFormDialog } from "./role-form-dialog"
import { rolesService } from "@/services/roles"

vi.mock("@/services/roles", () => ({
  rolesService: {
    create: vi.fn(),
    update: vi.fn(),
  },
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

const confirmDiscard = vi.hoisted(() => vi.fn())
vi.mock("@/components/common/confirm-dialog", () => ({
  useConfirm: () => confirmDiscard,
}))

describe("RoleFormDialog with TanStack Form", () => {
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

  const setInputValue = (el: HTMLInputElement | HTMLTextAreaElement, val: string) => {
    const proto = el instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    setter?.call(el, val)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  it("asks before discarding a draft and closes directly after restoring the initial value", async () => {
    confirmDiscard.mockResolvedValue(false)
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <RoleFormDialog open onOpenChange={onOpenChange} />
        </QueryClientProvider>,
      )
    })

    const nameInput = document.querySelector<HTMLInputElement>("#role-name")!
    const cancel = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "取消")!
    await act(async () => {
      setInputValue(nameInput, "临时名称")
    })
    await act(async () => cancel.click())
    expect(confirmDiscard).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => setInputValue(nameInput, ""))
    await act(async () => cancel.click())
    expect(confirmDiscard).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("intercepts invalid role code and short name before calling rolesService.create", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <RoleFormDialog open={true} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#role-code") as HTMLInputElement
    const nameInput = document.querySelector("input#role-name") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(codeInput).not.toBeNull()
    expect(nameInput).not.toBeNull()

    // 填入非法角色编码（数字开头）以及过短的名称
    await act(async () => {
      setInputValue(codeInput, "123invalid")
      setInputValue(nameInput, "a")
    })

    // 点击提交
    await act(async () => {
      submitBtn.click()
    })

    // 验证未调用后端 API
    expect(rolesService.create).not.toHaveBeenCalled()

    // 验证前端展示错误红字
    const codeError = document.querySelector("#role-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("以字母开头")

    const nameError = document.querySelector("#role-name-error")
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("角色名称至少 2 个字符")
  })

  it("submits valid form to backend and handles 400001 server error mapping with auto-heal", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "code", tag: "unique", message: "角色编码已存在" }],
        },
      },
    }

    vi.mocked(rolesService.create).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <RoleFormDialog open={true} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#role-code") as HTMLInputElement
    const nameInput = document.querySelector("input#role-name") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    // 填入符合前端 Zod 校验规则的值
    await act(async () => {
      setInputValue(codeInput, "auditor")
      setInputValue(nameInput, "审计专员")
    })

    // 点击提交
    await act(async () => {
      submitBtn.click()
    })

    // 前端放行并请求后端
    expect(rolesService.create).toHaveBeenCalledWith({
      code: "auditor",
      name: "审计专员",
      description: "",
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    // 后端错误自动回写至 #role-code-error
    const codeError = document.querySelector("#role-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("角色编码已存在")

    // 用户在输入框修改内容，后端错误即刻自愈（被清除）
    await act(async () => {
      setInputValue(codeInput, "auditor_ops")
    })

    const healedError = document.querySelector("#role-code-error")
    expect(healedError).toBeNull()
  })
})
