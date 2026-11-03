import { api } from "./api"
import type { PermissionDTO, PermissionType } from "./roles"
import type { Envelope } from "./types"

export type { PermissionDTO, PermissionType } from "./roles"

export interface PermissionPayload {
  parent_id?: string | null
  code: string
  name: string
  type: PermissionType
  path?: string
  method?: string
  component?: string
  icon?: string
  sort_order: number
}

export interface RouteSyncReport {
  discovered: number
  created: number
  existing: number
  policies_added: number
  policies_removed: number
  created_routes: Array<{ method: string; path: string }>
}

export const permissionsService = {
  tree: (signal?: AbortSignal) => api.get("/permissions", { signal }) as Promise<Envelope<PermissionDTO[]>>,
  create: (payload: PermissionPayload) =>
    api.post("/permissions", payload) as Promise<Envelope<PermissionDTO>>,
  update: (id: string, payload: PermissionPayload) =>
    api.put(`/permissions/${id}`, payload) as Promise<Envelope<PermissionDTO>>,
  remove: (id: string) =>
    api.delete(`/permissions/${id}`) as Promise<Envelope<{ deleted: boolean }>>,
  sync: () => api.post("/permissions/sync") as Promise<Envelope<RouteSyncReport>>,
}

export interface PermissionNode extends PermissionDTO { has_children: boolean; children?: PermissionNode[] }
export interface PermissionNodePage { items: PermissionNode[]; total: number; root_total: number; matched_nodes: number; retained_nodes: number; page: number; page_size: number }
export function permissionNodes(params: { parent_id?: string; keyword?: string; page: number; page_size: number }, signal?: AbortSignal) {
  return api.get("/permissions/nodes", {params,signal}) as Promise<Envelope<PermissionNodePage>>
}
