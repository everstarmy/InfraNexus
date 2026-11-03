import { describe, expect, it } from "vitest"
import { getErrorCode, getErrorMessage, getFieldErrors } from "./api-error"

const apiError = (status: number, body: unknown) => ({ isAxiosError: true, response: { status, data: body } })

describe("api error helpers", () => {
  it("prefers the server message and business code", () => {
    const err = apiError(400, { code: 400002, message: "密码强度不足", data: null })
    expect(getErrorMessage(err)).toBe("密码强度不足")
    expect(getErrorCode(err)).toBe(400002)
  })

  it("explains network failures instead of pretending the session expired", () => {
    expect(getErrorMessage({ isAxiosError: true, message: "Network Error" })).toBe("网络连接异常，请检查网络后重试")
    expect(getErrorMessage(new Error("boom"), "保存失败")).toBe("保存失败")
  })

  it("maps validation details to fields", () => {
    const err = apiError(400, { code: 400001, message: "请求参数校验失败", data: [{ field: "username", tag: "min", message: "字段 username 校验未通过 (min)" }] })
    expect(getFieldErrors(err)).toEqual({ username: "字段 username 校验未通过 (min)" })
  })
})
