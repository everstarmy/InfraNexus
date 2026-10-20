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

export const rolesService = {
  list: (keyword?: string) =>
    api.get("/roles", { params: { page: 1, page_size: 100, keyword: keyword || undefined } }) as Promise<Envelope<PageData<RoleDTO>>>,
  create: (payload: RolePayload) =>
    api.post("/roles", payload) as Promise<Envelope<RoleDTO>>,
  update: (id: string, payload: Partial<RolePayload> & { status?: number }) =>
    api.put(`/roles/${id}`, payload) as Promise<Envelope<RoleDTO>>,
  remove: (id: string) =>
    api.delete(`/roles/${id}`) as Promise<Envelope<{ deleted: boolean }>>,
  get: (id: string) => api.get(`/roles/${id}`) as Promise<Envelope<RoleDTO>>,
  permissionTree: () => api.get("/roles/permission-tree") as Promise<Envelope<PermissionDTO[]>>,
  assignPermissions: (roleId: string, permissionIds: string[]) =>
    api.post(`/roles/${roleId}/permissions`, { permission_ids: permissionIds }) as Promise<Envelope<{ assigned: boolean }>>,
}
