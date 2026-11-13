// @vitest-environment happy-dom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DepartmentMoveDialog } from "./department-move-dialog"
import type { DepartmentNode } from "@/services/departments"
import { departmentsService } from "@/services/departments"

vi.mock("@/services/departments", () => ({
  departmentsService: {
    move: vi.fn(),
  },
}))

vi.mock("@/components/common/confirm-dialog", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}))

vi.mock("@/hooks/use-unsaved-changes", () => ({
  useUnsavedChanges: vi.fn(),
}))

vi.mock("@/lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}))

const mockDepartment = {
  id: "dept-1",
  name: "基础架构组",
  code: "infra",
  parent_id: "root-1",
  status: 1,
  leader_name: "admin",
  member_count: 5,
  children: [],
} as unknown as DepartmentNode

const mockTree = [
  {
    id: "root-1",
    name: "研发中心",
    code: "rd",
    parent_id: null,
    status: 1,
    leader_name: "boss",
    member_count: 50,
    children: [mockDepartment],
  },
  {
    id: "root-2",
    name: "运营中心",
    code: "ops",
    parent_id: null,
    status: 1,
    leader_name: "ops_boss",
    member_count: 20,
    children: [],
  },
] as unknown as DepartmentNode[]

describe("DepartmentMoveDialog with TanStack Form", () => {
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

  it("intercepts submit when neither toRoot is toggled nor target is selected", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DepartmentMoveDialog
            department={mockDepartment}
            departments={mockTree}
            treeRevision={1}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()

    // 点击提交
    await act(async () => {
      submitBtn.click()
    })

    // 应该被前端拦截，不会调用 move
    expect(departmentsService.move).not.toHaveBeenCalled()
  })

  it("submits move with toRoot = true when switch is toggled", async () => {
    vi.mocked(departmentsService.move).mockResolvedValueOnce({} as any)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DepartmentMoveDialog
            department={mockDepartment}
            departments={mockTree}
            treeRevision={1}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const switchBtn = document.querySelector("#move-root") as HTMLElement
    expect(switchBtn).not.toBeNull()

    await act(async () => {
      switchBtn.click()
    })

    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      submitBtn.click()
    })

    expect(departmentsService.move).toHaveBeenCalledWith(mockDepartment.id, null, 1)
  })
})
