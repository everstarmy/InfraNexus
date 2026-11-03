import { api } from "./api"
import type { Envelope, PageData } from "./types"

export type PermissionType = "menu" | "button" | "api"

export interface PermissionDTO {
  id: string
  parent_id?: string | null
  code: string
  name: string
  type: PermissionType
  path?: string
  method?: string
  component?: string
  icon?: string
  sort_order?: number
  built_in?: boolean
  children?: PermissionDTO[]
}

export interface RoleDTO {
  id: string
  edit_revision: number
  code: string
  name: string
  description?: string
  status: number
  built_in: boolean
  user_count: number
  created_at: string
  permissions?: PermissionDTO[]
}

export interface RolePayload {
  code?: string
  name: string
  description?: string
}

export interface RoleListParams {
  page: number
  page_size: number
  keyword?: string
}

export const rolesService = {
  list: (params: RoleListParams, signal?: AbortSignal) =>
    api.get("/roles", { params, signal }) as Promise<Envelope<PageData<RoleDTO>>>,
  create: (payload: RolePayload) =>
    api.post("/roles", payload) as Promise<Envelope<RoleDTO>>,
  update: (id: string, payload: Partial<RolePayload> & { status?: number }) =>
    api.put(`/roles/${id}`, payload) as Promise<Envelope<RoleDTO>>,
  setStatus: (id: string, status: number, expectedRevision: number) =>
    api.patch(`/roles/${id}/status`, { status, expected_revision: expectedRevision }) as Promise<Envelope<RoleDTO>>,
  remove: (id: string) =>
    api.delete(`/roles/${id}`) as Promise<Envelope<{ deleted: boolean }>>,
  get: (id: string, signal?: AbortSignal) => api.get(`/roles/${id}`, { signal }) as Promise<Envelope<RoleDTO>>,
  permissionTree: (signal?: AbortSignal) => api.get("/roles/permission-tree", { signal }) as Promise<Envelope<PermissionDTO[]>>,
  assignPermissions: (roleId: string, permissionIds: string[], expectedRevision: number) =>
    api.post(`/roles/${roleId}/permissions`, { permission_ids: permissionIds, expected_revision: expectedRevision }) as Promise<Envelope<{ assigned: boolean }>>,
}
