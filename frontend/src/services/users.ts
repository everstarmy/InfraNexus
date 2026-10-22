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
  expected_revision?: number
  role_ids?: string[]
}

export interface UpdateUserPayload {
  nickname?: string
  email?: string
  avatar?: string
  expected_revision?: number
}

export const usersService = {
  list: (params: UserListParams, signal?: AbortSignal) =>
    api.get("/users", { params, signal }) as Promise<Envelope<PageData<UserDTO>>>,
  stats: (signal?: AbortSignal) => api.get("/users/stats", { signal }) as Promise<Envelope<UserStats>>,
  get: (id: string, signal?: AbortSignal) => api.get(`/users/${id}`, { signal }) as Promise<Envelope<UserDTO>>,
  create: (payload: CreateUserPayload) =>
    api.post("/users", payload) as Promise<Envelope<UserDTO>>,
  update: (id: string, payload: UpdateUserPayload) =>
    api.put(`/users/${id}`, payload) as Promise<Envelope<UserDTO>>,
  setDepartment: (id: string, departmentId: string | null, expectedRevision: number) =>
    api.put(`/users/${id}/department`, { department_id: departmentId, expected_revision: expectedRevision }) as Promise<Envelope<UserDTO>>,
  setStatus: (id: string, status: number, expectedRevision: number) =>
    api.patch(`/users/${id}/status`, { status, expected_revision: expectedRevision }) as Promise<Envelope<UserDTO>>,
  remove: (id: string) =>
    api.delete(`/users/${id}`) as Promise<Envelope<{ deleted: boolean }>>,
  resetPassword: (id: string, password: string) =>
    api.post(`/users/${id}/reset-password`, { password }) as Promise<Envelope<{ reset: boolean }>>,
  assignRoles: (id: string, roleIds: string[]) =>
    api.put(`/users/${id}/roles`, { role_ids: roleIds }) as Promise<Envelope<UserDTO>>,
  batchMove: (userIds: string[], targetDeptId: string, expectedRevision: number) =>
    api.post("/users/batch-move-department", { user_ids: userIds, target_dept_id: targetDeptId, expected_revision: expectedRevision }) as Promise<Envelope<{ moved: number }>>,
  updateMyPreferences: (preferences: UserPreferences) =>
    api.put("/users/me/preferences", preferences) as Promise<Envelope<UserPreferences>>,
}
