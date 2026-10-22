import { api } from "./api"
import type { Envelope } from "./types"

export interface DepartmentNode {
  id: string
  parent_id: string | null
  name: string
  code: string
  sort_order: number
  leader_id: string | null
  leader_name: string
  phone: string
  email: string
  status: number
  source: "local" | "ldap"
  tree_path: string
  depth: number
  member_count: number
  total_member_count: number
  children: DepartmentNode[]
}

export interface DepartmentPayload {
  expected_revision: number
  parent_id?: string | null
  name: string
  code: string
  sort_order: number
  leader_id?: string | null
  phone?: string
  email?: string
  status: number
}

export interface DepartmentTreeSnapshot {
  revision: number
  items: DepartmentNode[]
}

export const departmentsService = {
  tree: (signal?: AbortSignal) => api.get("/departments/tree", { signal }) as Promise<Envelope<DepartmentTreeSnapshot>>,
  create: (payload: DepartmentPayload) =>
    api.post("/departments", payload) as Promise<Envelope<DepartmentNode>>,
  update: (id: string, payload: DepartmentPayload) =>
    api.put(`/departments/${id}`, payload) as Promise<Envelope<DepartmentNode>>,
  move: (id: string, parentId: string | null, expectedRevision: number) =>
    api.post(`/departments/${id}/move`, { parent_id: parentId, expected_revision: expectedRevision }) as Promise<Envelope<DepartmentNode>>,
  moveRelative: (id: string, targetId: string, position: "before" | "after", expectedRevision: number) =>
    api.post(`/departments/${id}/move`, { target_id: targetId, position, expected_revision: expectedRevision }) as Promise<Envelope<DepartmentNode>>,
  reorder: (items: Array<{ id: string; sort_order: number }>, expectedRevision: number) =>
    api.put("/departments/reorder", { items, expected_revision: expectedRevision }) as Promise<Envelope<{ reordered: number }>>,
  remove: (id: string, expectedRevision: number) =>
    api.delete(`/departments/${id}`, { params: { expected_revision: expectedRevision } }) as Promise<Envelope<{ deleted: boolean }>>,
}
