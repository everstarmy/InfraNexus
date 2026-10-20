import { api } from "./api";

export interface PermissionDTO {
  id: string;
  parent_id?: string;
  code: string;
  name: string;
  type: "menu" | "button" | "api";
  path?: string;
  method?: string;
  icon?: string;
  sort_order?: number;
  children?: PermissionDTO[];
}

export interface RoleDTO {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: number;
  created_at: string;
  permissions?: PermissionDTO[];
}

export interface RoleListResponse {
  code: number;
  message: string;
  data: {
    items: RoleDTO[];
    total: number;
    page: number;
    page_size: number;
  };
}

export const rolesService = {
  getRoles: async (page = 1, pageSize = 50): Promise<RoleListResponse> => {
    return (await api.get("/roles", {
      params: { page, page_size: pageSize },
    })) as unknown as RoleListResponse;
  },

  createRole: async (payload: { code: string; name: string; description?: string }): Promise<{ code: number; data: RoleDTO }> => {
    return (await api.post("/roles", payload)) as unknown as { code: number; data: RoleDTO };
  },

  updateRole: async (
    id: string,
    payload: { name?: string; description?: string; status?: number }
  ): Promise<{ code: number; data: RoleDTO }> => {
    return (await api.put(`/roles/${id}`, payload)) as unknown as { code: number; data: RoleDTO };
  },

  deleteRole: async (id: string): Promise<{ code: number; data: { deleted: boolean } }> => {
    return (await api.delete(`/roles/${id}`)) as unknown as { code: number; data: { deleted: boolean } };
  },

  assignPermissions: async (roleId: string, permissionIds: string[]): Promise<{ code: number; data: { assigned: boolean } }> => {
    return (await api.post(`/roles/${roleId}/permissions`, {
      permission_ids: permissionIds,
    })) as unknown as { code: number; data: { assigned: boolean } };
  },

  getPermissionTree: async (): Promise<{ code: number; data: PermissionDTO[] }> => {
    return (await api.get("/permissions")) as unknown as { code: number; data: PermissionDTO[] };
  },
};
