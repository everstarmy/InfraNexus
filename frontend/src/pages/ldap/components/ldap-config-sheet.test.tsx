// @vitest-environment happy-dom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LdapConfigDialog } from "./ldap-config-sheet"
import { ldapService, type LDAPConfig } from "@/services/ldap"

vi.mock("@/services/ldap", () => ({
  ldapService: {
    create: vi.fn(),
    update: vi.fn(),
    test: vi.fn(),
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

const findButton = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((btn) => btn.textContent?.includes(text))

describe("LdapConfigDialog with TanStack Form", () => {
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

  it("validates Step 1 on Next and Test Connection before advancing, and heals errors on edit", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LdapConfigDialog
            open={true}
            config={null}
            departments={[]}
            roles={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    // 新建模式前 3 步主操作为“下一步”，而非直接暴露“创建配置”
    expect(document.querySelector('button[type="submit"]')).toBeNull()
    const nextBtn = findButton("下一步") as HTMLButtonElement
    const testBtn = findButton("测试连接") as HTMLButtonElement
    expect(nextBtn).toBeDefined()
    expect(testBtn).toBeDefined()

    // 未填直接点测试连接：拦截并展示校验错误
    await act(async () => {
      testBtn.click()
    })
    expect(ldapService.test).not.toHaveBeenCalled()
    expect(document.querySelector("#ldap-name-error")?.textContent).toContain("配置名称不能为空")

    // 未填直接点下一步：停留在第 1 步，不进入属性映射
    await act(async () => {
      nextBtn.click()
    })
    expect(document.querySelector('input[aria-label="登录账号"]')).toBeNull()
    expect(document.querySelector("#ldap-domain-error")?.textContent).toContain("认证域不能为空")

    // 填写第 1 步所有必填项：错误自愈后可顺利推进至第 2 步
    await act(async () => {
      setInputValue(document.querySelector("input#ldap-name") as HTMLInputElement, "总部 AD")
      setInputValue(document.querySelector("input#ldap-domain") as HTMLInputElement, "corp.local")
      setInputValue(document.querySelector("input#ldap-server_host") as HTMLInputElement, "dc01.corp.local")
      setInputValue(document.querySelector("input#ldap-bind_dn") as HTMLInputElement, "CN=svc,DC=corp,DC=local")
      setInputValue(document.querySelector("input#ldap-bind_password") as HTMLInputElement, "Secret123!")
      setInputValue(document.querySelector("input#ldap-base_dn") as HTMLInputElement, "DC=corp,DC=local")
    })

    expect(document.querySelector("#ldap-name-error")).toBeNull()
    expect(document.querySelector("#ldap-domain-error")).toBeNull()

    await act(async () => {
      nextBtn.click()
    })

    expect(document.querySelector('input[aria-label="登录账号"]')).not.toBeNull()
  })

  it("validates Step 3 OU mapping rows inline when advancing", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LdapConfigDialog
            open={true}
            config={null}
            initialTab="org"
            departments={[]}
            roles={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const addBtn = findButton("添加映射") as HTMLButtonElement
    await act(async () => {
      addBtn.click()
    })

    const nextBtn = findButton("下一步") as HTMLButtonElement
    await act(async () => {
      nextBtn.click()
    })

    expect(document.querySelector("#ldap-ou-dn-0-error")?.textContent).toContain("OU DN 不能为空")
    expect(document.querySelector("#ldap-ou-dept-0-error")?.textContent).toContain("请选择目标部门")
    expect(document.querySelector("#ldap-enabled")).toBeNull()
  })

  it("walks through wizard to Step 4 summary, submits, and handles 400001 error with auto-jump and heal", async () => {
    vi.mocked(ldapService.create).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "参数校验失败",
          data: [
            {
              field: "domain",
              message: "认证域已存在或冲突",
            },
          ],
        },
      },
    })

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LdapConfigDialog
            open={true}
            config={null}
            departments={[]}
            roles={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    await act(async () => {
      setInputValue(document.querySelector("input#ldap-name") as HTMLInputElement, "总部 Active Directory")
      setInputValue(document.querySelector("input#ldap-domain") as HTMLInputElement, "corp.local")
      setInputValue(document.querySelector("input#ldap-server_host") as HTMLInputElement, "dc01.corp.local")
      setInputValue(document.querySelector("input#ldap-bind_dn") as HTMLInputElement, "CN=svc,DC=corp,DC=local")
      setInputValue(document.querySelector("input#ldap-bind_password") as HTMLInputElement, "SecretPass123!")
      setInputValue(document.querySelector("input#ldap-base_dn") as HTMLInputElement, "DC=corp,DC=local")
    })

    // Step 1 -> 2 -> 3 -> 4
    for (let i = 0; i < 3; i++) {
      const nextBtn = findButton("下一步") as HTMLButtonElement
      await act(async () => {
        nextBtn.click()
      })
    }

    // 第 4 步展示配置摘要并出现“创建配置”按钮
    expect(document.body.textContent).toContain("配置摘要")
    expect(document.body.textContent).toContain("corp.local")
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()

    await act(async () => {
      submitBtn.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(ldapService.create).toHaveBeenCalledTimes(1)
    // 服务端返回 domain 错误时自动切回 Step 1 并显示行内错误
    const domainError = document.querySelector("#ldap-domain-error")
    expect(domainError).not.toBeNull()
    expect(domainError?.textContent).toContain("认证域已存在或冲突")

    await act(async () => {
      setInputValue(document.querySelector("input#ldap-domain") as HTMLInputElement, "corp2.local")
    })
    expect(document.querySelector("#ldap-domain-error")).toBeNull()
  })

  it("switches automatically to the connection tab when submitting from policy tab with invalid fields", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LdapConfigDialog
            open={true}
            config={null}
            initialTab="policy"
            departments={[]}
            roles={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()

    await act(async () => {
      submitBtn.click()
    })

    expect(ldapService.create).not.toHaveBeenCalled()

    const nameError = document.querySelector("#ldap-name-error")
    expect(nameError).not.toBeNull()
    expect(nameError?.textContent).toContain("配置名称不能为空")
  })

  it("renders direct save button and allows free tab switching in edit mode", async () => {
    const existingConfig: LDAPConfig = {
      id: "cfg-1",
      name: "现有 AD",
      type: "ad",
      domain: "corp.local",
      server_host: "dc01.corp.local",
      port: 389,
      use_ssl: false,
      start_tls: false,
      insecure_skip_verify: false,
      bind_dn: "CN=svc,DC=corp,DC=local",
      has_bind_password: true,
      base_dn: "DC=corp,DC=local",
      user_filter: "(&(objectClass=user)(sAMAccountName=%s))",
      attribute_mapping: {
        username: "sAMAccountName",
        email: "mail",
        nickname: "displayName",
        department: "department",
        external_id: "objectGUID",
      },
      department_sync: {
        strategy: "none",
        root_department_id: null,
        ou_mappings: [],
      },
      default_role_id: null,
      enabled: true,
      sync_enabled: false,
      sync_interval_minutes: 60,
      disable_missing_users: false,
      timeout_seconds: 10,
      sync_status: "idle",
      sync_started_at: null,
      sync_lease_expires_at: null,
      last_sync_at: null,
      last_success_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LdapConfigDialog
            open={true}
            config={existingConfig}
            departments={[]}
            roles={[]}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
    })

    // 编辑模式下直接显示“保存配置”和底部“测试连接”，不强迫点“下一步”
    expect(findButton("下一步")).toBeUndefined()
    expect(document.querySelector('button[type="submit"]')?.textContent).toContain("保存配置")
    expect(findButton("测试连接")).toBeDefined()
  })
})
