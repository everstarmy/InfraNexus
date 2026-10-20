import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/stores/auth-context"
import { notify } from "@/lib/notify"
import type { SyncReport } from "@/services/ldap"

export type NotificationTone = "info" | "success" | "warning" | "error"

export interface AppNotification {
  id: string
  title: string
  description: string
  tone: NotificationTone
  time: number
  read: boolean
}

type StreamStatus = "connecting" | "online" | "offline"

interface NotificationsContextType {
  items: AppNotification[]
  unread: number
  status: StreamStatus
  markAllRead: () => void
  clear: () => void
}

const NotificationsContext = React.createContext<NotificationsContextType | null>(null)

const STREAM_URL = `${import.meta.env.VITE_API_BASE_URL || "/api/v1"}/sse/notifications`

interface SyncEvent {
  domain: string
  mode?: string
  trigger?: string
  status?: string
  message?: string
  report?: SyncReport
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const [items, setItems] = React.useState<AppNotification[]>([])
  const [status, setStatus] = React.useState<StreamStatus>("offline")

  const push = React.useCallback((n: Omit<AppNotification, "id" | "time" | "read">) => {
    setItems((prev) => [{ ...n, id: crypto.randomUUID(), time: Date.now(), read: false }, ...prev].slice(0, 30))
  }, [])

  React.useEffect(() => {
    if (!isAuthenticated) {
      setStatus("offline")
      return
    }
    setStatus("connecting")
    const source = new EventSource(STREAM_URL, { withCredentials: true })
    const parse = (event: MessageEvent) => {
      try {
        return JSON.parse(event.data) as SyncEvent
      } catch {
        return undefined
      }
    }
    source.addEventListener("connected", () => setStatus("online"))
    source.addEventListener("ldap.sync.started", (event) => {
      const data = parse(event as MessageEvent)
      if (!data) return
      push({
        title: "目录同步已开始",
        description: `${data.domain} · ${data.mode === "incremental" ? "增量" : "全量"}同步（${data.trigger === "schedule" ? "定时触发" : "手动触发"}）`,
        tone: "info",
      })
    })
    source.addEventListener("ldap.sync.finished", (event) => {
      const data = parse(event as MessageEvent)
      if (!data) return
      const r = data.report
      const summary = r ? `新增 ${r.created} · 更新 ${r.updated} · 停用 ${r.disabled} · 失败 ${r.failed}` : data.message || ""
      const tone: NotificationTone = data.status === "success" ? "success" : data.status === "partial" ? "warning" : "error"
      const title = data.status === "failed" ? `目录同步失败 · ${data.domain}` : `目录同步完成 · ${data.domain}`
      push({ title, description: data.status === "failed" ? data.message || summary : summary, tone })
      if (tone === "error") notify.error(title, data.message)
      else if (tone === "warning") notify.warning(title, summary)
      else notify.success(title, summary)
      void queryClient.invalidateQueries({ queryKey: ["ldap"] })
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      void queryClient.invalidateQueries({ queryKey: ["departments"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    })
    source.onopen = () => setStatus("online")
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting")
    return () => source.close()
  }, [isAuthenticated, push, queryClient])

  const value = React.useMemo<NotificationsContextType>(
    () => ({
      items,
      unread: items.filter((n) => !n.read).length,
      status,
      markAllRead: () => setItems((prev) => prev.map((n) => ({ ...n, read: true }))),
      clear: () => setItems([]),
    }),
    [items, status],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  const ctx = React.useContext(NotificationsContext)
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider")
  return ctx
}
