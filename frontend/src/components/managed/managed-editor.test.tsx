// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ManagedEditor, type EditorField } from "./managed-editor"
import type { ManagedBase } from "@/services/managed"

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

interface MockWarehouse extends ManagedBase {
  contact_person?: string
  capacity?: number
}

describe("ManagedEditor with TanStack Form", () => {
  let queryClient: QueryClient
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  const fields: EditorField<MockWarehouse>[] = [
    { key: "contact_person", label: "库房联系人", type: "text", maxLength: 64, required: true },
    { key: "capacity", label: "库房容积", type: "number", min: 10, max: 1000 },
  ]

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
    const proto =
      el instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    setter?.call(el, val)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  it("intercepts missing required fields before save", async () => {
    const saveFn = vi.fn()
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ManagedEditor<MockWarehouse>
            title="备件库房"
            record={null}
            fields={fields}
            save={saveFn}
            onClose={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()

    await act(async () => {
      submitBtn.click()
    })

    expect(saveFn).not.toHaveBeenCalled()

    const codeError = document.querySelector('[id$="-code-error"]')
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("编码不能为空")

    const nameError = document.querySelector('[id$="-name-error"]')
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("名称不能为空")

    const contactError = document.querySelector('[id$="-contact_person-error"]')
    expect(contactError).not.toBeNull()
    expect(contactError?.textContent).toContain("库房联系人不能为空")
  })

  it("submits valid form and handles backend 400001 field error with auto-heal", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "参数校验失败",
          data: [{ field: "code", message: "备件库房编码已被占用" }],
        },
      },
    }
    const saveFn = vi.fn().mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ManagedEditor<MockWarehouse>
            title="备件库房"
            record={null}
            fields={fields}
            save={saveFn}
            onClose={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector('input[id$="-code"]') as HTMLInputElement
    const nameInput = document.querySelector('input[id$="-name"]') as HTMLInputElement
    const contactInput = document.querySelector('input[id$="-contact_person"]') as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(codeInput).not.toBeNull()
    expect(nameInput).not.toBeNull()
    expect(contactInput).not.toBeNull()

    await act(async () => {
      setInputValue(codeInput, "WH-BJ-01")
      setInputValue(nameInput, "北京主备件库房")
      setInputValue(contactInput, "张三")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "WH-BJ-01",
        name: "北京主备件库房",
        contact_person: "张三",
      }),
      expect.anything(),
    )

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const codeError = document.querySelector('[id$="-code-error"]')
    expect(codeError).not.toBeNull()
    expect(codeError?.textContent).toContain("备件库房编码已被占用")

    // 修改输入后自愈
    await act(async () => {
      setInputValue(codeInput, "WH-BJ-02")
    })

    expect(document.querySelector('[id$="-code-error"]')).toBeNull()
  })
})
