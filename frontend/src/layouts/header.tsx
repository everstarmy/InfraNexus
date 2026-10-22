import { useState } from "react"
import { useLocation } from "react-router-dom"
import { Bell, BellOff, CheckCheck, Moon, Sun, Trash2, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { setTheme } from "@/lib/theme"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useNotifications, type NotificationTone } from "@/stores/notifications"
import { findNavByPath } from "./nav-config"
import { AppCommandPalette } from "@/components/common/app-command-palette"

const toneDot: Record<NotificationTone, string> = {
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
}

export function Header({ onLogout }: { onLogout: () => void }) {
  const location = useLocation()
  const { items, unread, status, markRead, markAllRead, clear, desktopPermission, requestDesktopNotifications, soundEnabled, soundReady, toggleNotificationSound } = useNotifications()
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"))
  const current = findNavByPath(location.pathname)

  const toggleTheme = () => {
    const nextDark = !isDark
    setIsDark(nextDark)
    setTheme(nextDark ? "dark" : "light")
  }

  return (
    <header className="z-30 flex h-14 w-full shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 md:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden sm:inline-flex">{current?.group.label ?? "工作台"}</BreadcrumbItem>
            {current?.parent && (
              <>
                <BreadcrumbSeparator className="hidden sm:inline-flex" />
                <BreadcrumbItem className="hidden sm:inline-flex">{current.parent.title}</BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium text-foreground">{current?.item.title ?? "控制台"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <AppCommandPalette onLogout={onLogout} isDark={isDark} onToggleTheme={toggleTheme} />

        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" aria-label={`${unread > 0 ? `通知中心，${unread} 条未读` : "通知中心"}，${status === "online" ? "实时通道已连接" : status === "connecting" ? "实时通道正在连接" : "实时通道未连接"}`} />}>
            <Bell />
            <span aria-hidden className={cn("absolute right-1 bottom-1 size-2 rounded-full ring-2 ring-background", status === "online" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500 motion-safe:animate-pulse" : "bg-muted-foreground")} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </PopoverTrigger>
          <span className="sr-only" role="status" aria-live="polite">
            {status === "online" ? "实时推送已连接" : status === "connecting" ? "正在连接或重连实时通道" : "实时通道未连接"}
          </span>
          <PopoverContent align="end" className="w-88 p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold">通知中心</h4>
                <p role="status" aria-live="polite" className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span aria-hidden className={cn("size-1.5 rounded-full", status === "online" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500 motion-safe:animate-pulse" : "bg-muted-foreground")} />
                  {status === "online" ? "实时推送已连接" : status === "connecting" ? "正在连接或重连实时通道…" : "实时通道未连接"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <Button variant="ghost" size="xs" onClick={markAllRead} className="text-muted-foreground">
                    <CheckCheck />
                    全部已读
                  </Button>
                )}
                {items.length > 0 && (
                  <Button variant="ghost" size="icon-xs" onClick={clear} className="text-muted-foreground" aria-label="清空通知">
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => void requestDesktopNotifications()}
                disabled={desktopPermission !== "default"}
                aria-label={desktopPermission === "granted" ? "桌面通知已授权" : desktopPermission === "denied" ? "桌面通知被浏览器阻止" : "开启桌面通知"}
              >
                <Bell />
                {desktopPermission === "granted" ? "桌面通知已开启" : desktopPermission === "denied" ? "浏览器已阻止通知" : desktopPermission === "unsupported" ? "不支持桌面通知" : "开启桌面通知"}
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => void toggleNotificationSound()}
                aria-pressed={soundEnabled && soundReady}
                aria-label={soundEnabled && soundReady ? "关闭通知声音" : "开启通知声音"}
              >
                {soundEnabled && soundReady ? <VolumeX /> : <Volume2 />}
                {soundEnabled && soundReady ? "关闭声音" : "开启声音"}
              </Button>
              <span className="sr-only">桌面通知只会在你主动点击授权后启用，通知声音也可以随时关闭。</span>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
                  <BellOff className="size-5" />
                  暂无通知，目录同步等后台任务的进度会实时出现在这里
                </div>
              ) : (
                <ul className="space-y-1">
                  {items.map((n) => (
                    <li key={n.id} className={cn("flex gap-3 rounded-lg px-2.5 py-2", !n.read && "bg-muted/60")}>
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneDot[n.tone])} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{n.title}</p>
                        <p className="text-xs text-muted-foreground">{n.description}</p>
                        {n.taskId && n.progress !== undefined && (
                          <div
                            role="progressbar"
                            aria-label="目录同步进度"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={n.progress}
                            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                          >
                            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${n.progress}%` }} />
                          </div>
                        )}
                        {n.taskId && n.progress === undefined && (
                          <div role="progressbar" aria-label="正在读取目录并生成同步计划" aria-valuetext="同步计划生成中" className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-primary motion-reduce:animate-none" />
                          </div>
                        )}
                        <p className="mt-0.5 text-[10px] text-muted-foreground/80">{formatRelative(new Date(n.time).toISOString())}</p>
                      </div>
                      {!n.read && (
                        <Button variant="ghost" size="icon-xs" className="shrink-0" onClick={() => markRead(n.id)} aria-label={`标记「${n.title}」为已读`}>
                          <CheckCheck />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground" aria-label={isDark ? "切换至浅色模式" : "切换至深色模式"}>
          {isDark ? <Sun className="text-amber-400" /> : <Moon />}
        </Button>
      </div>
    </header>
  )
}
