import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router-dom"
import { Building2, FilePlus2, LogOut, Moon, Network, Search, Sun, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { flattenTree } from "@/lib/tree"
import { departmentsService } from "@/services/departments"
import { usersService } from "@/services/users"
import { useAuth } from "@/stores/auth-context"
import { navGroups, pageNavItems } from "@/layouts/nav-config"

interface AppCommandPaletteProps {
  onLogout: () => void
  isDark: boolean
  onToggleTheme: () => void
}

function recentsStorageKey(userId: string | undefined) {
  return userId ? `infranexus:command-recent-routes:v1:${encodeURIComponent(userId)}` : null
}

function readRecentRoutes(key: string | null) {
  if (!key || typeof window === "undefined") return [] as string[]
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]")
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : []
  } catch {
    return []
  }
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  return !!element && (element.isContentEditable || !!element.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"))
}

export function AppCommandPalette({ onLogout, isDark, onToggleTheme }: AppCommandPaletteProps) {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [recentRoutes, setRecentRoutes] = useState<string[]>([])
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const storageKey = recentsStorageKey(user?.id)
  const userSearchAllowed = can("api:GET:/api/v1/users")
  const detailAllowed = can("api:GET:/api/v1/users/:id")
  const departmentSearchAllowed = can("api:GET:/api/v1/departments/tree")

  const userSearch = useQuery({
    queryKey: ["command", "users", user?.id, debouncedSearch],
    queryFn: async ({ signal }) => (await usersService.list({ page: 1, page_size: 8, keyword: debouncedSearch }, signal)).data,
    enabled: open && userSearchAllowed && debouncedSearch.length >= 2,
  })
  const departmentSearch = useQuery({
    queryKey: ["command", "departments", user?.id, debouncedSearch],
    queryFn: async ({ signal }) => {
      const snapshot = (await departmentsService.tree(signal)).data
      const keyword = debouncedSearch.toLocaleLowerCase()
      return flattenTree(snapshot.items)
        .filter((node) => node.name.toLocaleLowerCase().includes(keyword) || node.code.toLocaleLowerCase().includes(keyword))
        .slice(0, 8)
    },
    enabled: open && departmentSearchAllowed && debouncedSearch.length >= 2,
  })

  const allowedPages = useMemo(
    () => pageNavItems.filter((item) => can(item.permission)),
    [can],
  )
  const recentPages = recentRoutes
    .map((path) => allowedPages.find((item) => item.url === path))
    .filter((item): item is (typeof allowedPages)[number] => !!item)
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
  const shortcut = isMac ? "⌘K" : "Ctrl+K"
  const isSearchingEntities = debouncedSearch.length >= 2
  const queryDebouncing = search.trim().length >= 2 && search.trim() !== debouncedSearch
  const dynamicLoading = isSearchingEntities && ((userSearchAllowed && userSearch.isFetching) || (departmentSearchAllowed && departmentSearch.isFetching))

  useEffect(() => {
    setRecentRoutes(readRecentRoutes(storageKey))
  }, [storageKey])

  useEffect(() => {
    const currentPath = pageNavItems.find((item) => item.url === location.pathname)?.url
    if (!currentPath || !storageKey) return
    setRecentRoutes((previous) => {
      const next = [currentPath, ...previous.filter((item) => item !== currentPath)].slice(0, 6)
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // Recent routes are optional; navigation remains available if storage is blocked.
      }
      return next
    })
  }, [location.pathname, storageKey])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey) || event.isComposing || event.keyCode === 229 || event.repeat || isEditableTarget(event.target)) return
      if (open) {
        event.preventDefault()
        setOpen(false)
        setSearch("")
        return
      }
      const anotherDialogOpen = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some((dialog) => dialog.getClientRects().length > 0)
      if (anotherDialogOpen) return
      event.preventDefault()
      setOpen(true)
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [open])

  const close = () => {
    setOpen(false)
    setSearch("")
  }
  const go = (path: string) => {
    close()
    navigate(path)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-52 justify-between rounded-lg bg-muted/30 px-2.5 text-xs font-normal text-muted-foreground shadow-none md:flex xl:w-64"
      >
        <span className="flex items-center gap-2"><Search className="size-3.5" />搜索页面与操作…</span>
        <Kbd className="h-4.5 px-1.5 text-[10px]">{shortcut}</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="搜索页面与操作">
        <Search />
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearch("")
        }}
        title="全局导航"
        description="搜索页面、用户、部门或执行快捷操作"
      >
        <Command>
          <CommandInput value={search} onValueChange={setSearch} placeholder="搜索页面、用户、部门或操作…" />
          <CommandList>
            <CommandEmpty>{dynamicLoading || queryDebouncing ? "正在搜索…" : "未找到相关页面、用户、部门或操作"}</CommandEmpty>
            {!search.trim() && recentPages.length > 0 && (
              <CommandGroup heading="最近访问">
                {recentPages.map((item) => (
                  <CommandItem key={`recent-${item.url}`} value={`最近 ${item.title} ${item.description}`} onSelect={() => go(item.url)}>
                    <item.icon className="text-muted-foreground" />
                    <span>{item.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">最近访问</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {navGroups.map((group) => {
              const flatItems = group.items.flatMap((item) => item.children ? item.children : [item])
              const allowed = flatItems.filter((item) => can(item.permission))
              if (!allowed.length) return null
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
            {search.trim().length > 0 && search.trim().length < 2 && (
              <CommandGroup heading="实体搜索">
                <div className="px-3 py-2 text-xs text-muted-foreground">输入至少 2 个字符搜索用户和部门。</div>
              </CommandGroup>
            )}
            {isSearchingEntities && !userSearchAllowed && !departmentSearchAllowed && (
              <CommandGroup heading="实体搜索">
                <CommandItem disabled value={`${debouncedSearch} 无权搜索用户部门`}>当前账号没有用户或部门搜索权限。</CommandItem>
              </CommandGroup>
            )}
            {isSearchingEntities && userSearchAllowed && (
              <CommandGroup heading={userSearch.isFetching ? "正在搜索用户…" : "用户"}>
                {userSearch.isFetching && <CommandItem disabled value={`${debouncedSearch} 正在搜索用户`}>正在查询用户…</CommandItem>}
                {userSearch.data?.items.map((item) => (
                  <CommandItem
                    key={`user-${item.id}`}
                    value={`用户 ${item.nickname || item.username} ${item.username} ${item.email}`}
                    onSelect={() => go(detailAllowed ? `/users?detail=${encodeURIComponent(item.id)}` : `/users?keyword=${encodeURIComponent(item.nickname || item.username)}`)}
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{(item.nickname || item.username).slice(0, 1).toUpperCase()}</span>
                    <span>{item.nickname || item.username}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">{item.username}</span>
                  </CommandItem>
                ))}
                {userSearch.isError && <CommandItem disabled value={`${debouncedSearch} 用户搜索暂不可用`}>用户搜索暂不可用，请稍后重试。</CommandItem>}
                {userSearch.isSuccess && userSearch.data.items.length === 0 && <CommandItem disabled value={`${debouncedSearch} 没有匹配的用户`}>没有匹配的用户。</CommandItem>}
              </CommandGroup>
            )}
            {isSearchingEntities && departmentSearchAllowed && (
              <CommandGroup heading={departmentSearch.isFetching ? "正在搜索部门…" : "部门"}>
                {departmentSearch.isFetching && <CommandItem disabled value={`${debouncedSearch} 正在搜索部门`}>正在查询部门…</CommandItem>}
                {departmentSearch.data?.map((department) => (
                  <CommandItem
                    key={`department-${department.id}`}
                    value={`部门 ${department.name} ${department.code}`}
                    onSelect={() => go(`/departments?focus=${encodeURIComponent(department.id)}`)}
                  >
                    <Network className="text-muted-foreground" />
                    <span>{department.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{department.code}</span>
                  </CommandItem>
                ))}
                {departmentSearch.isError && <CommandItem disabled value={`${debouncedSearch} 部门搜索暂不可用`}>部门搜索暂不可用，请稍后重试。</CommandItem>}
                {departmentSearch.isSuccess && departmentSearch.data.length === 0 && <CommandItem disabled value={`${debouncedSearch} 没有匹配的部门`}>没有匹配的部门。</CommandItem>}
              </CommandGroup>
            )}
            <CommandGroup heading="快捷创建">
              {can("users:create") && (
                <CommandItem value="新建用户 创建用户" onSelect={() => go("/users?create=1")}><Users /><span>新建用户</span></CommandItem>
              )}
              {can("departments:create") && (
                <CommandItem value="新建部门 创建部门" onSelect={() => go("/departments?create=1")}><Building2 /><span>新建部门</span></CommandItem>
              )}
              {can("roles:create") && (
                <CommandItem value="新建角色 创建角色" onSelect={() => go("/roles?create=1")}><FilePlus2 /><span>新建角色</span></CommandItem>
              )}
            </CommandGroup>
            <CommandGroup heading="偏好与账号">
              <CommandItem value="切换主题 深色 浅色" onSelect={() => { onToggleTheme(); close() }}>
                {isDark ? <Sun className="text-amber-500" /> : <Moon />}
                <span>切换至{isDark ? "浅色" : "深色"}模式</span>
              </CommandItem>
              <CommandItem value="退出登录 注销" onSelect={() => { close(); onLogout() }}>
                <LogOut className="text-destructive" /><span className="text-destructive">退出登录</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
