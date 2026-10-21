import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Bell, BellOff, CheckCheck, ChevronDown, LogOut, Moon, Search, Settings, Sun } from "lucide-react"
import { UserPreferencesDialog } from "./components/user-preferences-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Kbd } from "@/components/ui/kbd"
import { AuthSourceBadge } from "@/components/common/badges"
import { setTheme } from "@/lib/theme"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useAuth } from "@/stores/auth-context"
import { useNotifications, type NotificationTone } from "@/stores/notifications"
import { findNavByPath, navGroups } from "./nav-config"

const toneDot: Record<NotificationTone, string> = {
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
}

export function Header({ onLogout }: { onLogout: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, can } = useAuth()
  const { items, unread, status, markAllRead, clear } = useNotifications()
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"))
  const [searchOpen, setSearchOpen] = useState(false)
  const [prefOpen, setPrefOpen] = useState(false)
  const current = findNavByPath(location.pathname)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const toggleTheme = () => {
    const nextDark = !isDark
    setIsDark(nextDark)
    setTheme(nextDark ? "dark" : "light")
  }

  const go = (path: string) => {
    setSearchOpen(false)
    navigate(path)
  }

  const displayName = user?.nickname || user?.username || ""
  const roleNames = user?.roles?.map((r) => r.name).join("、")

  return (
    <header className="z-30 flex h-14 w-full shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md supports-backdrop-filter:bg-background/70 md:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden sm:inline-flex">{current?.group.label ?? "工作台"}</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium text-foreground">{current?.item.title ?? "控制台"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSearchOpen(true)}
          className="hidden h-8 w-52 justify-between rounded-lg bg-muted/30 px-2.5 text-xs font-normal text-muted-foreground shadow-none md:flex xl:w-64"
        >
          <span className="flex items-center gap-2">
            <Search className="size-3.5" />
            搜索页面与操作…
          </span>
          <Kbd className="h-4.5 px-1.5 text-[10px]">⌘K</Kbd>
        </Button>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSearchOpen(true)} aria-label="搜索">
          <Search />
        </Button>

        <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="全局导航" description="输入关键词快速跳转页面或执行操作">
          <Command>
            <CommandInput placeholder="输入页面或功能名称…" />
            <CommandList>
              <CommandEmpty>未找到相关页面或操作</CommandEmpty>
              {navGroups.map((group) => {
                const allowed = group.items.filter((item) => can(item.permission))
                if (allowed.length === 0) return null
                return (
                  <CommandGroup key={group.label} heading={group.label}>
                    {allowed.map((item) => (
                      <CommandItem key={item.url} value={`${item.title} ${item.description}`} onSelect={() => go(item.url)}>
                        <item.icon className="text-muted-foreground" />
                        <span>{item.title}</span>
                        <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              })}
              <CommandGroup heading="偏好与账号">
                <CommandItem
                  onSelect={() => {
                    toggleTheme()
                    setSearchOpen(false)
                  }}
                >
                  {isDark ? <Sun className="text-amber-500" /> : <Moon />}
                  <span>切换至{isDark ? "浅色" : "深色"}模式</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setSearchOpen(false)
                    onLogout()
                  }}
                >
                  <LogOut className="text-destructive" />
                  <span className="text-destructive">退出登录</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </CommandDialog>

        <Popover onOpenChange={(open) => !open && unread > 0 && markAllRead()}>
          <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" aria-label="通知中心" />}>
            <Bell />
            {unread > 0 && (
              <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-88 p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold">通知中心</h4>
                <p className="text-[11px] text-muted-foreground">
                  {status === "online" ? "实时推送已连接 (SSE)" : status === "connecting" ? "正在重新连接实时通道…" : "实时通道未连接"}
                </p>
              </div>
              {items.length > 0 && (
                <Button variant="ghost" size="xs" onClick={clear} className="text-muted-foreground">
                  <CheckCheck />
                  清空
                </Button>
              )}
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
                        <p className="mt-0.5 text-[10px] text-muted-foreground/80">{formatRelative(new Date(n.time).toISOString())}</p>
                      </div>
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

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" className="h-9 gap-2 rounded-full border border-transparent pr-2.5 pl-1 hover:border-border/60" />}
          >
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{displayName.slice(0, 1).toUpperCase() || "U"}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-28 flex-col text-left md:flex">
              <span className="truncate text-xs leading-tight font-semibold">{displayName}</span>
              <span className="truncate text-[10px] leading-tight text-muted-foreground">{roleNames || "未分配角色"}</span>
            </span>
            <ChevronDown className="hidden size-3.5 text-muted-foreground md:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
                  {user && <AuthSourceBadge authType={user.auth_type} />}
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {user?.username}
                  {user?.domain ? `@${user.domain}` : ""}
                </p>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPrefOpen(true)}>
              <Settings className="size-4" />
              偏好与会话设置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onLogout}>
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <UserPreferencesDialog open={prefOpen} onOpenChange={setPrefOpen} />
      </div>
    </header>
  )
}
