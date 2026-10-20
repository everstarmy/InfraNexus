import { api } from "./api";
import { UserDTO } from "./auth";

export interface UserListParams {
  page?: number;
  page_size?: number;
  keyword?: string;
  status?: number;
  role_id?: string;
}

export interface UserListResponse {
  code: number;
  message: string;
  data: {
    items: UserDTO[];
    total: number;
    page: number;
    page_size: number;
  };
}

export interface CreateUserPayload {
  username: string;
  email: string;
  password: string;
  nickname?: string;
  role_ids?: string[];
}

export interface UpdateUserPayload {
  nickname?: string;
  avatar?: string;
  status?: number;
  role_ids?: string[];
}

export const usersService = {
  getUsers: async (params: UserListParams): Promise<UserListResponse> => {
    return (await api.get("/users", { params })) as unknown as UserListResponse;
  },

  getUser: async (id: string): Promise<{ code: number; data: UserDTO }> => {
    return (await api.get(`/users/${id}`)) as unknown as { code: number; data: UserDTO };
  },

  createUser: async (payload: CreateUserPayload): Promise<{ code: number; data: UserDTO }> => {
    return (await api.post("/users", payload)) as unknown as { code: number; data: UserDTO };
  },

  updateUser: async (id: string, payload: UpdateUserPayload): Promise<{ code: number; data: UserDTO }> => {
    return (await api.put(`/users/${id}`, payload)) as unknown as { code: number; data: UserDTO };
  },

  toggleStatus: async (id: string, status: number): Promise<{ code: number; data: { status: number } }> => {
    return (await api.patch(`/users/${id}/status`, { status })) as unknown as { code: number; data: { status: number } };
  },

  deleteUser: async (id: string): Promise<{ code: number; data: { deleted: boolean } }> => {
    return (await api.delete(`/users/${id}`)) as unknown as { code: number; data: { deleted: boolean } };
  },
};
