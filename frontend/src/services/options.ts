import { api } from "./api"
import type { DepartmentTreeSnapshot } from "./departments"
import type { Envelope, RoleRef } from "./types"

export const optionsService = {
  roles: (signal?: AbortSignal) => api.get("/options/roles", { signal }) as Promise<Envelope<RoleRef[]>>,
  departments: (signal?: AbortSignal) => api.get("/options/departments", { signal }) as Promise<Envelope<DepartmentTreeSnapshot>>,
}
