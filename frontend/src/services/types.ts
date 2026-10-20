export interface Envelope<T> {
  code: number
  message: string
  data: T
  request_id: string
  timestamp?: number
}

export interface PageData<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type AuthType = "local" | "ad" | "ldap"

export interface RoleRef {
  id: string
  code: string
  name: string
  status?: number
  built_in?: boolean
}

export interface DepartmentRef {
  id: string
  name: string
  code: string
  parent_id?: string | null
  tree_path?: string
  status?: number
  source?: string
}

export interface UserDTO {
  id: string
  username: string
  domain: string
  email: string
  nickname: string
  avatar?: string
  status: number
  auth_type: AuthType
  external_id?: string
  department_id?: string | null
  department?: DepartmentRef | null
  built_in: boolean
  last_login_at?: string | null
  roles?: RoleRef[]
  preferences?: { theme?: string; locale?: string; pinned_routes?: string[] | null }
  created_at?: string
  updated_at?: string
}

export interface CurrentUser extends UserDTO {
  permissions: string[]
  is_admin: boolean
}
