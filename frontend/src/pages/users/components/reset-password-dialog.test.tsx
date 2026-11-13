// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ResetPasswordDialog } from "./reset-password-dialog"
import type { UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

vi.mock("@/services/users", () => ({
  usersService: {
    resetPassword: vi.fn(),
  },
}))

vi.mock("@/lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}))

const mockUser = {
  id: "user-123",
  username: "alice",
  nickname: "Alice",
  status: 1,
  department_id: "dept-1",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
} as UserDTO

describe("ResetPasswordDialog with TanStack Form", () => {
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

  it("intercepts mismatched or weak passwords before invoking API", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ResetPasswordDialog
            user={mockUser}
            isSelf={false}
            onOpenChange={vi.fn()}
            onSelfReset={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const passwordInput = document.querySelector("input#reset-password") as HTMLInputElement
    const confirmInput = document.querySelector("input#reset-confirm") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(passwordInput).not.toBeNull()
    expect(confirmInput).not.toBeNull()

    // 填入弱密码以及不匹配的确认密码
    await act(async () => {
      setInputValue(passwordInput, "weak")
      setInputValue(confirmInput, "different")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(usersService.resetPassword).not.toHaveBeenCalled()

    const passwordError = document.querySelector("#reset-password-error")
    expect(passwordError).not.toBeNull()
    expect(passwordError?.textContent).toContain("密码长度至少 8 位")
  })

  it("supports auto-generation of strong password and submits successfully", async () => {
    vi.mocked(usersService.resetPassword).mockResolvedValueOnce({} as any)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ResetPasswordDialog
            user={mockUser}
            isSelf={false}
            onOpenChange={vi.fn()}
            onSelfReset={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    // 点击“生成”按钮
    const generateBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("生成"),
    )
    expect(generateBtn).toBeDefined()

    await act(async () => {
      generateBtn?.click()
    })

    const passwordInput = document.querySelector("input#reset-password") as HTMLInputElement
    const confirmInput = document.querySelector("input#reset-confirm") as HTMLInputElement
    expect(passwordInput.value.length).toBeGreaterThanOrEqual(12)
    expect(passwordInput.value).toBe(confirmInput.value)

    // 提交
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      submitBtn.click()
    })

    expect(usersService.resetPassword).toHaveBeenCalledWith(mockUser.id, passwordInput.value)
  })
})
