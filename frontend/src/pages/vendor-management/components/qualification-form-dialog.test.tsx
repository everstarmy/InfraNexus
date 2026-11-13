// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QualificationFormDialog } from "./qualification-form-dialog"
import { qualificationsService } from "@/services/vendor-management"

vi.mock("@/services/vendor-management", () => ({
  qualificationsService: {
    create: vi.fn(),
    update: vi.fn(),
  },
  manufacturersService: {
    list: vi.fn().mockResolvedValue({
      data: {
        items: [{ id: "m-1", name: "Cisco", code: "cisco" }],
        total: 1,
      },
    }),
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

describe("QualificationFormDialog with TanStack Form", () => {
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

  const setSelectValue = (el: HTMLSelectElement, val: string) => {
    el.value = val
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  it("intercepts invalid date, validUntil < validFrom, and missing OEM manufacturer on submit", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <QualificationFormDialog
            open={true}
            vendorId="v-1"
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#qual-code") as HTMLInputElement
    const nameInput = document.querySelector("input#qual-name") as HTMLInputElement
    const validFromInput = document.querySelector("input#qual-validFrom") as HTMLInputElement
    const validUntilInput = document.querySelector("input#qual-validUntil") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(codeInput).not.toBeNull()
    expect(nameInput).not.toBeNull()
    expect(validFromInput).not.toBeNull()
    expect(validUntilInput).not.toBeNull()

    await act(async () => {
      setInputValue(codeInput, "qual-01")
      setInputValue(nameInput, "Cisco Gold Partner")
      setInputValue(validFromInput, "2026-06-01")
      setInputValue(validUntilInput, "2026-01-01")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(qualificationsService.create).not.toHaveBeenCalled()

    const validUntilError = document.querySelector("#qual-validUntil-error")
    expect(validUntilError).not.toBeNull()
    expect(validUntilError?.textContent).toContain("截止日期不能早于生效起始日期")

    const mfgError = document.querySelector("#qual-manufacturerId-error")
    expect(mfgError).not.toBeNull()
    expect(mfgError?.textContent).toContain("原厂授权资质必须指定授权厂商")
  })

  it("handles backend 400001 snake_case field error and auto-heals", async () => {
    vi.mocked(qualificationsService.create).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "参数校验失败",
          data: [
            {
              field: "certificate_no",
              message: "证书/授权编号已存在或已被归档",
            },
          ],
        },
      },
    })

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <QualificationFormDialog
            open={true}
            vendorId="v-1"
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const kindSelect = document.querySelector("select#qual-kind") as HTMLSelectElement
    const codeInput = document.querySelector("input#qual-code") as HTMLInputElement
    const nameInput = document.querySelector("input#qual-name") as HTMLInputElement
    const certTypeInput = document.querySelector("input#qual-certType") as HTMLInputElement
    const certNoInput = document.querySelector("input#qual-certNo") as HTMLInputElement
    const validFromInput = document.querySelector("input#qual-validFrom") as HTMLInputElement
    const validUntilInput = document.querySelector("input#qual-validUntil") as HTMLInputElement
    const evidenceInput = document.querySelector("input#qual-evidenceRef") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      setSelectValue(kindSelect, "media_destruction")
      setInputValue(codeInput, "qual-valid")
      setInputValue(nameInput, "涉密介质销毁资质")
      setInputValue(certTypeInput, "乙级销毁")
      setInputValue(certNoInput, "CERT-8888")
      setInputValue(validFromInput, "2026-01-01")
      setInputValue(validUntilInput, "2027-01-01")
      setInputValue(evidenceInput, "DOC-REF-001")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(qualificationsService.create).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const certNoError = document.querySelector("#qual-certNo-error")
    expect(certNoError).not.toBeNull()
    expect(certNoError?.textContent).toContain("证书/授权编号已存在或已被归档")

    await act(async () => {
      setInputValue(certNoInput, "CERT-8889")
    })

    expect(document.querySelector("#qual-certNo-error")).toBeNull()
  })
})
