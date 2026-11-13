// @vitest-environment happy-dom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserFormDialog } from "./user-form-dialog"
import { usersService } from "@/services/users"
import type { UserDTO } from "@/services/types"

vi.mock("@/services/users", () => ({
  usersService: {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
  },
}))

vi.mock("@/stores/auth-context", () => ({
  useAuth: () => ({
    can: () => false,
  }),
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

const setInputValue = (el: HTMLInputElement, val: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  setter?.call(el, val)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("UserFormDialog with TanStack Form", () => {
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
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
  })

  it("blocks invalid creation on client and maps 400001 server error with auto-heal", async () => {
    vi.mocked(usersService.create).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "参数校验未通过",
          data: [{ field: "username", message: "该用户名已被系统占用" }],
        },
      },
    })

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <UserFormDialog
            open
            onOpenChange={vi.fn()}
            departments={[]}
            treeRevision={1}
            roles={[]}
          />
        </QueryClientProvider>,
      )
    })

    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      submitBtn.click()
    })

    expect(usersService.create).not.toHaveBeenCalled()
    expect(document.querySelector("#user-username-error")).not.toBeNull()
    expect(document.querySelector("#user-email-error")).not.toBeNull()
    expect(document.querySelector("#user-password-error")).not.toBeNull()

    const usernameInput = document.querySelector("#user-username") as HTMLInputElement
    const emailInput = document.querySelector("#user-email") as HTMLInputElement
    const passwordInput = document.querySelector("#user-password") as HTMLInputElement

    await act(async () => {
      setInputValue(usernameInput, "alice")
      setInputValue(emailInput, "alice@example.com")
      setInputValue(passwordInput, "Str0ng!Pass")
    })

    await act(async () => {
      submitBtn.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(usersService.create).toHaveBeenCalledTimes(1)
    const serverErr = document.querySelector("#user-username-error")
    expect(serverErr?.textContent).toContain("该用户名已被系统占用")

    await act(async () => {
      setInputValue(usernameInput, "alice2")
    })
    expect(document.querySelector("#user-username-error")).toBeNull()
  })

  it("handles 409 optimistic lock conflict and allows continuing with refreshed revision", async () => {
    const existingUser: UserDTO = {
      id: "u-1",
      username: "alice",
      email: "alice@example.com",
      nickname: "Alice",
      status: 1,
      auth_type: "local",
      domain: "local",
      built_in: false,
      department_id: null,
      edit_revision: 3,
      roles: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }

    vi.mocked(usersService.update)
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            code: 409001,
            message: "用户资料已被他人修改",
          },
        },
      })
      .mockResolvedValueOnce({
        code: 200000,
        message: "ok",
        request_id: "req-1",
        data: { ...existingUser, nickname: "Alice New", edit_revision: 5 },
      })

    vi.mocked(usersService.get).mockResolvedValueOnce({
      code: 200000,
      message: "ok",
      request_id: "req-2",
      data: { ...existingUser, nickname: "Alice Server", edit_revision: 4 },
    })

    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <UserFormDialog
            open
            onOpenChange={onOpenChange}
            user={existingUser}
            departments={[]}
            treeRevision={1}
            roles={[]}
          />
        </QueryClientProvider>,
      )
    })

    const nicknameInput = document.querySelector("#user-nickname") as HTMLInputElement
    await act(async () => {
      setInputValue(nicknameInput, "Alice New")
    })

    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      submitBtn.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const conflictGroup = document.querySelector('[aria-label="用户资料并发冲突"]')
    expect(conflictGroup).not.toBeNull()
    expect(conflictGroup?.textContent).toContain("Alice Server")

    const continueBtn = Array.from(conflictGroup?.querySelectorAll("button") ?? []).find((btn) =>
      btn.textContent?.includes("确认保留草稿并继续编辑"),
    ) as HTMLButtonElement
    await act(async () => {
      continueBtn.click()
    })

    await act(async () => {
      submitBtn.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(usersService.update).toHaveBeenNthCalledWith(2, "u-1", {
      expected_revision: 4,
      nickname: "Alice New",
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
