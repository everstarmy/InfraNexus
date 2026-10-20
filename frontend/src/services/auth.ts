import { api } from "./api";
export interface LoginParams {
  username: string;
  password: string;
}
export interface UserDTO {
  id: string;
  username: string;
  email: string;
  nickname: string;
  avatar?: string;
  status: number;
  roles?: Array<{ id: string; code: string; name: string }>;
  preferences?: { theme?: string; locale?: string; pinned_routes?: string[] };
  created_at?: string;
  updated_at?: string;
}
export interface Envelope<T> {
  code: number;
  message: string;
  data: T;
  request_id: string;
}
export const authService = {
  login: (params: LoginParams) =>
    api.post("/auth/login", params) as Promise<Envelope<{ user: UserDTO }>>,
  logout: () =>
    api.post("/auth/logout") as Promise<Envelope<{ logged_out: boolean }>>,
  getProfile: () => api.get("/auth/me") as Promise<Envelope<UserDTO>>,
};
