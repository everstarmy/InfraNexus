import { api } from "./api"
import type { CurrentUser, Envelope } from "./types"

export type { CurrentUser, Envelope, UserDTO } from "./types"

export interface LoginParams {
  username: string
  password: string
  domain?: string
}

export interface AuthDomain {
  domain: string
  name: string
  type: "ad" | "ldap"
}

export const authService = {
  login: (params: LoginParams) =>
    api.post("/auth/login", params) as Promise<Envelope<{ user: CurrentUser }>>,
  logout: () =>
    api.post("/auth/logout") as Promise<Envelope<{ logged_out: boolean }>>,
  getProfile: () => api.get("/auth/me") as Promise<Envelope<CurrentUser>>,
  domains: () => api.get("/auth/domains") as Promise<Envelope<AuthDomain[]>>,
}
