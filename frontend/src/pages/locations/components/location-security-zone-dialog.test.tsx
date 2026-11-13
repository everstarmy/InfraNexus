// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocationSecurityZoneDialog } from "./location-security-zone-dialog"
import { locationsService, type LocationNode } from "@/services/locations"
import { securityZonesService } from "@/services/ipam"

vi.mock("@/services/locations", () => ({
  locationsService: {
    securityZone: vi.fn(),
  },
}))

vi.mock("@/services/ipam", () => ({
  securityZonesService: {
    list: vi.fn().mockResolvedValue({
      data: {
        items: [
          { id: "zone-dmz", name: "DMZ 隔离区", code: "DMZ-01" },
          { id: "zone-core", name: "核心内网区", code: "CORE-01" },
        ],
        total: 2,
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

const mockRack = {
  uid: "rack-1",
  name: "A-01",
  type: "rack",
  version: 1,
  security_zone_id: null,
  path: [{ uid: "dc-1", name: "北京亦庄数据中心", type: "datacenter" }],
} as unknown as LocationNode

describe("LocationSecurityZoneDialog with TanStack Form", () => {
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

  it("renders security zones and submits newly selected security zone", async () => {
    vi.mocked(locationsService.securityZone).mockResolvedValueOnce({
      data: { ...mockRack, security_zone_id: "zone-dmz" },
    } as any)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocationSecurityZoneDialog
            open={true}
            onOpenChange={vi.fn()}
            rack={mockRack}
          />
        </QueryClientProvider>,
      )
    })

    // 等待 Query 返回
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const radios = document.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>
    expect(radios.length).toBe(3) // 无安全域 + 2 个区域

    // 选择 DMZ
    await act(async () => {
      radios[1].click()
    })

    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      submitBtn.click()
    })

    expect(locationsService.securityZone).toHaveBeenCalledWith("rack-1", 1, "zone-dmz")
  })
})
