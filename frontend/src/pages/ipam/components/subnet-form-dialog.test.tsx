// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SubnetFormDialog } from "./subnet-form-dialog"
import { subnetsService } from "@/services/ipam"

vi.mock("@/services/ipam", () => ({
  subnetsService: {
    create: vi.fn(),
    update: vi.fn(),
  },
  networkScopesService: {
    list: vi.fn().mockResolvedValue({
      data: {
        items: [{ id: "scope-1", name: "生产 VRF" }],
        total: 1,
      },
    }),
  },
  securityZonesService: {
    list: vi.fn().mockResolvedValue({
      data: {
        items: [{ id: "zone-1", name: "核心安全域" }],
        total: 1,
      },
    }),
  },
}))

vi.mock("@/hooks/use-unsaved-changes", () => ({
  useUnsavedChanges: vi.fn(),
}))

vi.mock("@/stores/auth-context", () => ({
  useAuth: () => ({
    can: () => true,
    user: { id: "user-1", username: "admin" },
  }),
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

describe("SubnetFormDialog with TanStack Form", () => {
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

  it("intercepts invalid CIDR, DNS and missing required scopes before calling API", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SubnetFormDialog open={true} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )
    })

    const codeInput = document.querySelector("input#subnet-code") as HTMLInputElement
    const nameInput = document.querySelector("input#subnet-name") as HTMLInputElement
    const cidrInput = document.querySelector("input#subnet-cidr") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    expect(codeInput).not.toBeNull()
    expect(nameInput).not.toBeNull()
    expect(cidrInput).not.toBeNull()

    const dnsInput = document.querySelector<HTMLInputElement>("#subnet-dns_servers")!
    await act(async () => {
      setInputValue(codeInput, "subnet-bj01")
      setInputValue(nameInput, "北京主中心网段")
      setInputValue(cidrInput, "999.20.1.0/24")
      setInputValue(dnsInput, "999.1.1.1")
    })

    await act(async () => {
      submitBtn.click()
    })

    expect(subnetsService.create).not.toHaveBeenCalled()

    expect(document.querySelector("#subnet-dns_servers-error")?.textContent).toContain("合法的 IPv4 或 IPv6")
    const scopeTrigger = document.querySelector("#subnet-scope-trigger")
    expect(scopeTrigger?.getAttribute("aria-invalid")).toBe("true")
    expect(document.querySelector('label[for="subnet-scope-trigger"]')).not.toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(scopeTrigger))

    const cidrError = document.querySelector("#subnet-cidr-error")
    expect(cidrError).not.toBeNull()
    expect(cidrError?.textContent).toContain("请输入合法的 IPv4 CIDR")

    await act(async () => {
      setInputValue(dnsInput, Array.from({ length: 9 }, (_, index) => `2001:db8::${index}`).join(", "))
    })
    expect(document.querySelector("#subnet-dns_servers-error")?.textContent).toContain("最多填写 8 个")
  })

  it("handles backend 400001 CIDR conflict mapping and auto-healing", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "业务校验未通过",
          data: [{ field: "cidr", tag: "overlap", message: "网段 10.20.1.0/24 与既有子网重叠冲突" }],
        },
      },
    }

    vi.mocked(subnetsService.update).mockRejectedValueOnce(backendError)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SubnetFormDialog
            open={true}
            onOpenChange={vi.fn()}
            subnet={{
              id: "subnet-1",
              code: "subnet-bj01",
              name: "北京主中心网段",
              network_scope_id: "scope-1",
              security_zone_id: "zone-1",
              cidr: "10.20.1.0/24",
              gateway: "10.20.1.1",
              vlan_id: 101,
              usage_type: "production",
              dns_servers: ["114.114.114.114"],
              is_allocatable: true,
              description: "",
              created_at: "2026-01-01",
              updated_at: "2026-01-01",
            } as any}
          />
        </QueryClientProvider>,
      )
    })

    const cidrInput = document.querySelector("input#subnet-cidr") as HTMLInputElement
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement

    await act(async () => {
      submitBtn.click()
    })

    expect(subnetsService.update).toHaveBeenCalled()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const cidrError = document.querySelector("#subnet-cidr-error")
    expect(cidrError).not.toBeNull()
    expect(cidrError?.textContent).toContain("重叠冲突")

    // 修改 CIDR 后错误自愈
    await act(async () => {
      setInputValue(cidrInput, "10.20.2.0/24")
    })

    const healedError = document.querySelector("#subnet-cidr-error")
    expect(healedError).toBeNull()
  })
})
