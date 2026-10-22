import { api } from "./api"
import type { SyncLog, SyncStatus } from "./ldap"
import type { Envelope } from "./types"
import type { UserStats } from "./users"

export interface DashboardOverview {
  users: UserStats
  departments: { total: number; enabled: number; disabled: number; from_directory: number }
  roles: { total: number; built_in: number }
  permissions: { menus: number; buttons: number; apis: number }
  directories: Array<{
    id: string
    name: string
    domain: string
    type: "ad" | "ldap"
    enabled: boolean
    sync_enabled: boolean
    sync_status: SyncStatus
    last_sync_at: string | null
  }>
  recent_syncs: SyncLog[]
}

export const dashboardService = {
  overview: (signal?: AbortSignal) => api.get("/dashboard/overview", { signal }) as Promise<Envelope<DashboardOverview>>,
}
