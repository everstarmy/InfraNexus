// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PermissionFormDialog } from "./permission-form-dialog"
import { permissionsService } from "@/services/permissions"

vi.mock("@/services/permissions", () => ({
  permissionsService: {
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

describe("PermissionFormDialog with TanStack Form", () => {
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

  it("intercepts invalid empty name or short code before submitting", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PermissionFormDialog
            state={{ mode: "create", parentId: null }}
            tree={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const nameInput = document.querySelector("input#perm-name") as HTMLInputElement
    const codeInput = document.querySelector("input#perm-code") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(nameInput).not.toBeNull()
    expect(codeInput).not.toBeNull()

    await act(async () => {
      setInputValue(nameInput, "")
      setInputValue(codeInput, "a")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(permissionsService.create).not.toHaveBeenCalled()

    const nameError = document.querySelector("#perm-name-error")
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("权限点名称不能为空")

    const codeError = document.querySelector("#perm-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("权限编码至少 2 个字符")
  })

  it("submits valid permission and handles 400001 code conflict", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "code", tag: "unique", message: "权限编码已存在" }],
        },
      },
    }

    vi.mocked(permissionsService.create).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PermissionFormDialog
            state={{ mode: "create", parentId: null }}
            tree={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const nameInput = document.querySelector("input#perm-name") as HTMLInputElement
    const codeInput = document.querySelector("input#perm-code") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(nameInput, "导出审计日志")
      setInputValue(codeInput, "audit:export")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(permissionsService.create).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const codeError = document.querySelector("#perm-code-error")
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("权限编码已存在")

    // 修改后错误自愈
    await act(async () => {
      setInputValue(codeInput, "audit:export-all")
    })

    expect(document.querySelector("#perm-code-error")).toBeNull()
  })

  it("validates fields per node type and clears validation errors when switching type", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PermissionFormDialog
            state={{ mode: "create", parentId: null }}
            tree={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const getToggleBtn = (label: string) =>
      Array.from(document.querySelectorAll("button")).find((btn) => btn.textContent?.includes(label)) as HTMLButtonElement

    // 1. 切换到“接口”类型：空路径点击提交应报错“接口路径不能为空”
    await act(async () => {
      getToggleBtn("接口").click()
    })

    const nameInput = document.querySelector("input#perm-name") as HTMLInputElement
    const codeInput = document.querySelector("input#perm-code") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setInputValue(nameInput, "导出接口")
      setInputValue(codeInput, "api:GET:/reports")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(permissionsService.create).not.toHaveBeenCalled()
    expect(document.querySelector("#perm-path-error")?.textContent).toContain("接口路径不能为空")

    // 2. 切换回“菜单”类型：原有验证错误信息应被全部清除
    await act(async () => {
      getToggleBtn("菜单").click()
    })

    expect(document.querySelector("#perm-path-error")).toBeNull()
    expect(document.querySelector("#perm-name-error")).toBeNull()
    expect(document.querySelector("#perm-code-error")).toBeNull()

    // 3. 在“菜单”类型下填写不符合 / 开头的路径再提交，触发菜单路由错误；随后切换到“按钮”类型，错误清除且按钮类型不校验隐藏的 path
    const pathInput = document.querySelector("input#perm-path") as HTMLInputElement
    await act(async () => {
      setInputValue(pathInput, "invalid-relative-path")
    })
    await act(async () => {
      submitBtn.click()
    })

    expect(permissionsService.create).not.toHaveBeenCalled()
    expect(document.querySelector("#perm-path-error")?.textContent).toContain("前端路由若填写需以 / 开头")

    await act(async () => {
      getToggleBtn("按钮").click()
    })

    expect(document.querySelector("#perm-path-error")).toBeNull()

    vi.mocked(permissionsService.create).mockResolvedValueOnce({
      code: 200000,
      message: "ok",
      request_id: "req-1",
      data: {
        id: "p-1",
        parent_id: null,
        code: "api:GET:/reports",
        name: "导出接口",
        type: "button",
        path: "",
        method: "",
        component: "",
        icon: "",
        sort_order: 0,
        built_in: false,
      },
    })

    await act(async () => {
      submitBtn.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(permissionsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "button",
        name: "导出接口",
        code: "api:GET:/reports",
        path: "",
      }),
    )
  })
})
