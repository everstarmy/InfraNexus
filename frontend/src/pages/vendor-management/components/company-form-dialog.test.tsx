// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { companiesService, type CompanyDTO } from "@/services/vendor-management"
import { CompanyFormDialog } from "./company-form-dialog"
import { validateCreditCode } from "./company-meta"

vi.mock("@/services/vendor-management", () => ({
  companiesService: {
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

describe("CompanyFormDialog", () => {
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
    const proto =
      el instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    setter?.call(el, val)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  const submitForm = async () => {
    const form = document.querySelector("form")!
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
  }

  it("validates GB 32100 unified social credit codes consistently with backend", () => {
    expect(validateCreditCode("")).toBeNull()
    expect(validateCreditCode("914403001922038216")).toBeNull()
    expect(validateCreditCode("91440300192203821x")).toBe("统一社会信用代码校验位无效")
    expect(validateCreditCode("9144030019220382")).toBe("统一社会信用代码需为 18 位")
    expect(validateCreditCode("9144030019220382IO")).toBe("统一社会信用代码包含非法字符")
  })

  it("blocks submit on client validation errors and allows creating combined type=3 via checkboxes", async () => {
    vi.mocked(companiesService.create).mockResolvedValue({
      code: 200000,
      message: "ok",
      request_id: "req-1",
      data: {
        id: "c-1",
        name: "华为技术有限公司",
        type: 3,
        status: 1,
        version: 1,
        created_at: "",
        updated_at: "",
      },
    })

    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyFormDialog open company={null} onOpenChange={onOpenChange} />
        </QueryClientProvider>,
      )
    })

    // Submit empty form -> fails type/name validation without calling API
    await submitForm()
    expect(companiesService.create).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请至少选择一种厂商类型")
    expect(document.body.textContent).toContain("请输入厂商名称")

    const checkboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    expect(checkboxes).toHaveLength(2)

    await act(async () => {
      checkboxes[0].click()
      checkboxes[1].click()
    })

    await act(async () => {
      setInputValue(document.querySelector<HTMLInputElement>("#company-name")!, "华为技术有限公司")
      setInputValue(document.querySelector<HTMLInputElement>("#company-short_name")!, "华为")
      setInputValue(document.querySelector<HTMLInputElement>("#company-english_name")!, "Huawei")
      setInputValue(document.querySelector<HTMLInputElement>("#company-credit_code")!, "914403001922038216")
      setInputValue(document.querySelector<HTMLInputElement>("#company-website")!, "https://www.huawei.com")
    })

    await submitForm()

    expect(companiesService.create).toHaveBeenCalledWith({
      credit_code: "914403001922038216",
      type: 3,
      name: "华为技术有限公司",
      short_name: "华为",
      english_name: "Huawei",
      website: "https://www.huawei.com",
      description: "",
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("pre-checks checkboxes in edit mode, maps server errors, and confirms dirty discard", async () => {
    confirmDiscard.mockResolvedValue(false)
    vi.mocked(companiesService.update).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "参数校验未通过",
          data: [{ field: "credit_code", message: "统一社会信用代码校验位无效" }],
        },
      },
    })

    const company: CompanyDTO = {
      id: "c-2",
      name: "戴尔中国",
      type: 3,
      short_name: "Dell",
      english_name: "Dell Technologies",
      website: "https://www.dell.com",
      description: "服务器原厂",
      status: 1,
      version: 2,
      created_at: "",
      updated_at: "",
    }

    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyFormDialog open company={company} onOpenChange={onOpenChange} />
        </QueryClientProvider>,
      )
    })


    const checkboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    expect(checkboxes[0].getAttribute("aria-checked")).toBe("true")
    expect(checkboxes[1].getAttribute("aria-checked")).toBe("true")

    // Uncheck supplier -> type becomes 1
    await act(async () => {
      checkboxes[1].click()
    })

    await submitForm()

    expect(companiesService.update).toHaveBeenCalledWith(company, {
      credit_code: "",
      type: 1,
      name: "戴尔中国",
      short_name: "Dell",
      english_name: "Dell Technologies",
      website: "https://www.dell.com",
      description: "服务器原厂",
    })
    expect(document.body.textContent).toContain("统一社会信用代码校验位无效")

    const cancel = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "取消",
    )!
    await act(async () => cancel.click())
    expect(confirmDiscard).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
