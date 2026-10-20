import { api } from "./api"
import type { DepartmentNode } from "./departments"
import type { Envelope, RoleRef } from "./types"

export const optionsService = {
  roles: () => api.get("/options/roles") as Promise<Envelope<RoleRef[]>>,
  departments: () => api.get("/options/departments") as Promise<Envelope<DepartmentNode[]>>,
}
