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
  parent_id?: string | null
  name: string
  code: string
  sort_order: number
  leader_id?: string | null
  phone?: string
  email?: string
  status: number
}

export const departmentsService = {
  tree: () => api.get("/departments/tree") as Promise<Envelope<DepartmentNode[]>>,
  create: (payload: DepartmentPayload) =>
    api.post("/departments", payload) as Promise<Envelope<DepartmentNode>>,
  update: (id: string, payload: DepartmentPayload) =>
    api.put(`/departments/${id}`, payload) as Promise<Envelope<DepartmentNode>>,
  move: (id: string, parentId: string | null) =>
    api.post(`/departments/${id}/move`, { parent_id: parentId }) as Promise<Envelope<DepartmentNode>>,
  reorder: (items: Array<{ id: string; sort_order: number }>) =>
    api.put("/departments/reorder", { items }) as Promise<Envelope<{ reordered: number }>>,
  remove: (id: string) =>
    api.delete(`/departments/${id}`) as Promise<Envelope<{ deleted: boolean }>>,
}
