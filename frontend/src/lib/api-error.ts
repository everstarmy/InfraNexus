export interface ApiErrorBody {
  code?: number
  message?: string
  data?: unknown
}

interface AxiosLike {
  isAxiosError?: boolean
  response?: { status?: number; data?: unknown }
}

export const BizCode = {
  ParamInvalid: 400001,
  PasswordTooWeak: 400002,
  DomainNotFound: 400003,
  TokenExpired: 401001,
  InvalidCredentials: 401002,
  SessionRevoked: 401003,
  PermissionDenied: 403001,
  AccountDisabled: 403002,
  BuiltinProtected: 403003,
  SelfOperationDenied: 403004,
  ResourceConflict: 409001,
  DepartmentHasChildren: 409002,
  DepartmentHasMembers: 409003,
  SyncInProgress: 409005,
  ExternalAccountManaged: 409007,
  DirectoryUnavailable: 502001,
} as const

function asAxios(error: unknown): AxiosLike | undefined {
  if (error && typeof error === "object" && (error as AxiosLike).isAxiosError) return error as AxiosLike
  return undefined
}

export function apiErrorBody(error: unknown): ApiErrorBody | undefined {
  const data = asAxios(error)?.response?.data
  if (data && typeof data === "object") return data as ApiErrorBody
  return undefined
}

export function getErrorCode(error: unknown) {
  return apiErrorBody(error)?.code
}

export function getErrorStatus(error: unknown) {
  return asAxios(error)?.response?.status
}

export function getErrorMessage(error: unknown, fallback = "操作失败，请稍后重试") {
  const axios = asAxios(error)
  if (axios && !axios.response) return "网络连接异常，请检查网络后重试"
  return apiErrorBody(error)?.message || fallback
}

export function getFieldErrors(error: unknown): Record<string, string> {
  const details = apiErrorBody(error)?.data
  if (!Array.isArray(details)) return {}
  const out: Record<string, string> = {}
  for (const item of details) {
    if (item && typeof item === "object" && "field" in item && "message" in item) {
      out[String(item.field)] = String(item.message)
    }
  }
  return out
}
