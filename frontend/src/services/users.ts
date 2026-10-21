import { api } from "./api"
import type { Envelope, PageData, UserDTO, UserPreferences } from "./types"

export interface UserListParams {
  page?: number
  page_size?: number
  keyword?: string
  status?: string
  auth_type?: string
  role_id?: string
  department_id?: string
  include_children?: boolean
  sort?: string
}

export interface UserStats {
  total: number
  active: number
  disabled: number
  local: number
  directory: number
  unassigned: number
  by_domain: Array<{ domain: string; auth_type: string; count: number }>
}

export interface CreateUserPayload {
  username: string
  email: string
  password: string
  nickname?: string
  department_id?: string | null
  role_ids?: string[]
}

export interface UpdateUserPayload {
  nickname?: string
  email?: string
  avatar?: string
  status?: number
  department_id?: string | null
  role_ids?: string[]
}

export const usersService = {
  list: (params: UserListParams) =>
    api.get("/users", { params }) as Promise<Envelope<PageData<UserDTO>>>,
  stats: () => api.get("/users/stats") as Promise<Envelope<UserStats>>,
  get: (id: string) => api.get(`/users/${id}`) as Promise<Envelope<UserDTO>>,
  create: (payload: CreateUserPayload) =>
    api.post("/users", payload) as Promise<Envelope<UserDTO>>,
  update: (id: string, payload: UpdateUserPayload) =>
    api.put(`/users/${id}`, payload) as Promise<Envelope<UserDTO>>,
  setStatus: (id: string, status: number) =>
    api.patch(`/users/${id}/status`, { status }) as Promise<Envelope<{ status: number }>>,
  remove: (id: string) =>
    api.delete(`/users/${id}`) as Promise<Envelope<{ deleted: boolean }>>,
  resetPassword: (id: string, password: string) =>
    api.post(`/users/${id}/reset-password`, { password }) as Promise<Envelope<{ reset: boolean }>>,
  assignRoles: (id: string, roleIds: string[]) =>
    api.put(`/users/${id}/roles`, { role_ids: roleIds }) as Promise<Envelope<UserDTO>>,
  batchMove: (userIds: string[], targetDeptId: string) =>
    api.post("/users/batch-move-department", { user_ids: userIds, target_dept_id: targetDeptId }) as Promise<Envelope<{ moved: number }>>,
  updateMyPreferences: (preferences: UserPreferences) =>
    api.put("/users/me/preferences", preferences) as Promise<Envelope<UserPreferences>>,
}
