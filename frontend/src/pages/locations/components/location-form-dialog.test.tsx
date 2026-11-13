// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocationFormDialog } from "./location-form-dialog"
import { locationsService } from "@/services/locations"

vi.mock("@/services/locations", () => ({
  locationsService: {
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

describe("LocationFormDialog with TanStack Form", () => {
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

  it("intercepts invalid datacenter form on frontend when missing required contact", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocationFormDialog
            open={true}
            onOpenChange={vi.fn()}
            type="datacenter"
          />
        </QueryClientProvider>,
      )
    })

    const nameInput = document.querySelector("input#location-name") as HTMLInputElement
    const addressInput = document.querySelector("input#location-address") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(nameInput).not.toBeNull()
    expect(addressInput).not.toBeNull()

    await act(async () => {
      setInputValue(nameInput, "北京亦庄数据中心")
      setInputValue(addressInput, "北京市大兴区亦庄经济开发区")
      // contactName 留空
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(locationsService.create).not.toHaveBeenCalled()

    const contactError = document.querySelector("#location-contactName-error")
    expect(contactError).not.toBeNull()
    expect(contactError?.textContent).toContain("联系人姓名必须在 1 到 128 个字符之间")
  })

  it("validates rack row and height bounds, then submits valid rack and handles server error", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "name", tag: "unique", message: "同级机房下已存在同名机柜" }],
        },
      },
    }

    vi.mocked(locationsService.create).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocationFormDialog
            open={true}
            onOpenChange={vi.fn()}
            type="rack"
            parent={{ uid: "room-1", name: "101机房", type: "room", version: 1 } as unknown as any}
          />
        </QueryClientProvider>,
      )
    })

    const nameInput = document.querySelector("input#location-name") as HTMLInputElement
    const rowInput = document.querySelector("input#location-row") as HTMLInputElement
    const heightInput = document.querySelector("input#location-heightU") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    // 1. 先输入非法行号（例如 99）与非法机柜高度（例如 200U）
    await act(async () => {
      setInputValue(nameInput, "A-01")
      setInputValue(rowInput, "99")
      setInputValue(heightInput, "200")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(locationsService.create).not.toHaveBeenCalled()
    expect(document.querySelector("#location-row-error")?.textContent).toContain("机柜行必须为 A–Z 或 1–25")
    expect(document.querySelector("#location-heightU-error")?.textContent).toContain("机柜高度必须为 1 到 100 U")

    // 2. 修正为合法值
    await act(async () => {
      setInputValue(rowInput, "A")
      setInputValue(heightInput, "42")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(locationsService.create).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    // 验证后端 400001 错误回写
    const nameError = document.querySelector("#location-name-error")
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("同名机柜")

    // 用户修改名称后错误自愈
    await act(async () => {
      setInputValue(nameInput, "A-02")
    })

    expect(document.querySelector("#location-name-error")).toBeNull()
  })
})
