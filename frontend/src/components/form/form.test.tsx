// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { FormField } from "./form-field"
import { useAppForm } from "./use-app-form"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const testSchema = z.object({
  username: z.string().trim().min(3, "用户名至少 3 个字符"),
  email: z.string().trim().email("邮箱格式不正确"),
  firstName: z.string().trim(),
})

function TestComponent({
  onSubmit,
  open = true,
  resetKey,
  initialUsername = "",
}: {
  onSubmit: (values: { username: string; email: string; firstName: string }) => Promise<void>
  open?: boolean
  resetKey?: string
  initialUsername?: string
}) {
  const { form, formError, formRef, submit, hasChanges } = useAppForm({
    open,
    resetKey,
    serverFieldNames: { "account.username": "username" },
    defaultValues: {
      username: initialUsername,
      email: "",
      firstName: "",
    },
    schema: testSchema,
    onSubmit,
  })

  return (
    <form
      ref={formRef}
      data-changed={hasChanges}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void submit()
      }}
    >
      {formError && <div role="alert">{formError}</div>}
      <form.Field name="username">
        {(field) => (
          <FormField field={field} label="用户名" idPrefix="test">
            {(inputProps) => (
              <input
                {...inputProps}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            )}
          </FormField>
        )}
      </form.Field>

      <form.Field name="email">
        {(field) => (
          <FormField field={field} label="邮箱" idPrefix="test">
            {(inputProps) => (
              <input
                {...inputProps}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            )}
          </FormField>
        )}
      </form.Field>

      <form.Field name="firstName">
        {(field) => (
          <FormField field={field} label="名字" idPrefix="test">
            {(inputProps) => (
              <input
                {...inputProps}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            )}
          </FormField>
        )}
      </form.Field>

      <button type="submit">提交</button>
    </form>
  )
}

describe("TanStack Form Infrastructure", () => {
  it("intercepts invalid submission on frontend before calling onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<TestComponent onSubmit={onSubmit} />)
    })

    // 初始状态下不应显示错误
    expect(host.querySelector("#test-username-error")).toBeNull()

    // 点击提交：此时为空，应该被前端 Zod 校验拦截，绝不调用 onSubmit
    const submitBtn = host.querySelector("button")!
    await act(async () => {
      submitBtn.click()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    // 前端验证失败后，展示 Zod 错误信息
    const usernameError = host.querySelector("#test-username-error")
    expect(usernameError).not.toBeNull()
    expect(usernameError?.textContent).toContain("用户名至少 3 个字符")

    act(() => root.unmount())
    host.remove()
  })

  it("tracks restored values, preserves drafts on refresh, and resets when the target changes", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    const onSubmit = vi.fn()
    const render = (resetKey: string, initialUsername = "") =>
      act(async () => root.render(
        <TestComponent onSubmit={onSubmit} resetKey={resetKey} initialUsername={initialUsername} />,
      ))

    try {
      await render("first")
      const input = host.querySelector<HTMLInputElement>("#test-username")!
      const changeUsername = (value: string) => act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })

      await changeUsername("draft")
      expect(host.querySelector("form")?.dataset.changed).toBe("true")
      await changeUsername("")
      expect(host.querySelector("form")?.dataset.changed).toBe("false")
      await changeUsername("draft")
      await render("first", "refreshed")
      expect(input.value).toBe("draft")
      expect(host.querySelector("form")?.dataset.changed).toBe("true")

      await render("second", "refreshed")
      expect(input.value).toBe("refreshed")
      expect(host.querySelector("form")?.dataset.changed).toBe("false")
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it("passes frontend validation when valid and invokes onSubmit, then displays backend error", async () => {
    const backendError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "请求参数校验失败",
          data: [
            { field: "account.username", tag: "min", message: "该用户名已被占用" },
          ],
        },
      },
    }
    const onSubmit = vi.fn().mockRejectedValue(backendError)
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<TestComponent onSubmit={onSubmit} />)
    })

    const usernameInput = host.querySelector('input#test-username') as HTMLInputElement
    const emailInput = host.querySelector('input#test-email') as HTMLInputElement
    const submitBtn = host.querySelector("button")!

    // 填入符合前端 Zod 格式的内容
    const setInputValue = (el: HTMLInputElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      setter?.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }

    await act(async () => {
      setInputValue(usernameInput, "validuser")
      setInputValue(emailInput, "valid@example.com")
    })

    // 点击提交：前端验证通过，发起 onSubmit
    await act(async () => {
      submitBtn.click()
    })

    expect(onSubmit).toHaveBeenCalled()

    // 等待异步完成与状态更新
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    // 后端错误被 applyServerErrors 自动回写到对应字段
    const usernameError = host.querySelector("#test-username-error")
    expect(usernameError).not.toBeNull()
    expect(usernameError?.textContent).toContain("该用户名已被占用")

    // 用户修改该字段时，服务端错误应即刻自愈（被清除）
    await act(async () => {
      setInputValue(usernameInput, "newuser")
    })

    const clearedError = host.querySelector("#test-username-error")
    expect(clearedError).toBeNull()
    expect(host.querySelector('[role="alert"]')).toBeNull()

    act(() => root.unmount())
    host.remove()
  })

  it("maps snake_case server fields to camelCase automatically without explicit mapping", async () => {
    const serverError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 400001,
          message: "参数校验未通过",
          data: [{ field: "first_name", message: "名字格式不合规" }],
        },
      },
    }
    const onSubmit = vi.fn().mockRejectedValue(serverError)

    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<TestComponent onSubmit={onSubmit} />)
    })

    const usernameInput = host.querySelector("#test-username") as HTMLInputElement
    const emailInput = host.querySelector("#test-email") as HTMLInputElement
    const firstNameInput = host.querySelector("#test-firstName") as HTMLInputElement

    const setInputValue = (el: HTMLInputElement, val: string) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set
      nativeInputValueSetter?.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }

    await act(async () => {
      setInputValue(usernameInput, "alice")
      setInputValue(emailInput, "alice@example.com")
    })

    const submitBtn = host.querySelector("button")!
    await act(async () => {
      submitBtn.click()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const firstNameError = host.querySelector("#test-firstName-error")
    expect(firstNameError).not.toBeNull()
    expect(firstNameError?.textContent).toContain("名字格式不合规")

    await act(async () => {
      setInputValue(firstNameInput, "Alice")
    })

    expect(host.querySelector("#test-firstName-error")).toBeNull()

    act(() => root.unmount())
    host.remove()
  })
})
