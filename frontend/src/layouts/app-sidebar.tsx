import * as React from "react"
import { Link, useLocation } from "react-router-dom"
import { ChevronRight, ChevronsUpDown, Layers, LogOut, Settings } from "lucide-react"
import { motion } from "motion/react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { AuthSourceBadge } from "@/components/common/badges"
import { UserPreferencesDialog } from "./components/user-preferences-dialog"
import { cn } from "@/lib/utils"
import { useAuth } from "@/stores/auth-context"
import { preloadPage } from "@/routing/pages"
import { navGroups, type NavItem } from "./nav-config"

const spring = { type: "spring", bounce: 0.18, duration: 0.45 } as const

const buttonMotion =
  "relative isolate overflow-visible transition-[width,height,padding,background-color,color,transform] duration-200 ease-out group-data-[collapsible=icon]:overflow-hidden active:scale-[0.98] data-active:bg-transparent data-active:hover:bg-transparent data-active:hover:text-primary motion-reduce:transition-none motion-reduce:active:scale-100"

const ActivePill = () => (
  <motion.span
    layoutId="sidebar-active-pill"
    transition={spring}
    className="absolute inset-0 -z-10 rounded-md bg-primary/10 shadow-xs ring-1 ring-primary/25 dark:bg-primary/15 dark:ring-primary/30"
  />
)

function NavMenuItem({ item, activeUrl }: { item: NavItem; activeUrl: string }) {
  const Icon = item.icon
  const { state, isMobile } = useSidebar()
  const isCollapsed = state === "collapsed" && !isMobile
  const hasChildren = item.children && item.children.length > 0

  if (!hasChildren) {
    const isActive = activeUrl === item.url || activeUrl.startsWith(`${item.url}/`)

    if (isCollapsed) {
      return (
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              openOnHover
              delay={70}
              closeDelay={140}
              render={
                <SidebarMenuButton
                  isActive={isActive}
                  className={buttonMotion}
                  render={
                    <Link
                      to={item.url}
                      onPointerEnter={() => preloadPage(item.url)}
                      onFocus={() => preloadPage(item.url)}
                      onTouchStart={() => preloadPage(item.url)}
                    />
                  }
                />
              }
            >
              {isActive && <ActivePill />}
              <Icon className={cn("size-4 shrink-0 transition-colors", isActive ? "text-primary" : "text-muted-foreground")} />
              <span>{item.title}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              sideOffset={8}
              className="w-52 rounded-xl p-1.5 shadow-lg border border-border/80"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={
                    <Link
                      to={item.url}
                      onPointerEnter={() => preloadPage(item.url)}
                      onFocus={() => preloadPage(item.url)}
                    />
                  }
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <Icon className="size-4 shrink-0" />
                    <span>{item.title}</span>
                  </div>
                  {item.description && (
                    <span className="text-xs text-muted-foreground font-normal leading-normal">
                      {item.description}
                    </span>
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      )
    }

    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isActive}
          className={buttonMotion}
          render={
            <Link
              to={item.url}
              onPointerEnter={() => preloadPage(item.url)}
              onFocus={() => preloadPage(item.url)}
              onTouchStart={() => preloadPage(item.url)}
            />
          }
        >
          {isActive && <ActivePill />}
          <Icon className={cn("size-4 shrink-0 transition-colors", isActive ? "text-primary" : "text-muted-foreground")} />
          <span className={cn("transition-colors", isActive ? "font-medium text-primary" : "text-sidebar-foreground")}>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  const isChildActive = item.children?.some(
    (c) => activeUrl === c.url || activeUrl.startsWith(`${c.url}/`)
  )

  // When sidebar is collapsed to icon rail: hover over the icon triggers flyout submenu to the right!
  if (isCollapsed) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            openOnHover
            delay={70}
            closeDelay={140}
            render={
              <SidebarMenuButton
                className={buttonMotion}
                isActive={isChildActive}
              />
            }
          >
            {isChildActive && <ActivePill />}
            <Icon className={cn("size-4 shrink-0 transition-colors", isChildActive ? "text-primary" : "text-muted-foreground")} />
            <span>{item.title}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-48 rounded-xl p-1.5 shadow-lg border border-border/80"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                {item.title}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuGroup>
              {item.children!.map((child) => {
                const ChildIcon = child.icon
                const isSubActive = activeUrl === child.url || activeUrl.startsWith(`${child.url}/`)
                const hasSubChildren = child.children && child.children.length > 0

                if (hasSubChildren) {
                  return (
                    <DropdownMenuSub key={child.url}>
                      <DropdownMenuSubTrigger className={cn("gap-2 text-sm", isSubActive && "font-medium text-primary")}>
                        {ChildIcon && <ChildIcon className="size-4 shrink-0" />}
                        <span>{child.title}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-44 rounded-xl p-1.5 shadow-lg border border-border/80">
                        {child.children!.map((subChild) => {
                          const SubIcon = subChild.icon
                          const isGrandChildActive = activeUrl === subChild.url || activeUrl.startsWith(`${subChild.url}/`)
                          return (
                            <DropdownMenuItem
                              key={subChild.url}
                              render={
                                <Link
                                  to={subChild.url}
                                  onPointerEnter={() => preloadPage(subChild.url)}
                                  onFocus={() => preloadPage(subChild.url)}
                                />
                              }
                              className={cn(
                                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                                isGrandChildActive
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-foreground hover:bg-accent"
                              )}
                            >
                              {SubIcon && <SubIcon className="size-4 shrink-0" />}
                              <span>{subChild.title}</span>
                            </DropdownMenuItem>
                          )
                        })}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
                }

                return (
                  <DropdownMenuItem
                    key={child.url}
                    render={
                      <Link
                        to={child.url}
                        onPointerEnter={() => preloadPage(child.url)}
                        onFocus={() => preloadPage(child.url)}
                      />
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                      isSubActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground hover:bg-accent"
                    )}
                  >
                    {ChildIcon && <ChildIcon className="size-4 shrink-0" />}
                    <span>{child.title}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    )
  }

  // When expanded: standard in-place collapsible submenu
  return (
    <SidebarMenuItem>
      <Collapsible defaultOpen={isChildActive || true} className="group/collapsible w-full">
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              className={buttonMotion}
              isActive={isChildActive}
            />
          }
        >
          <Icon className={cn("size-4 shrink-0 transition-colors", isChildActive ? "text-primary" : "text-muted-foreground")} />
          <span className={cn("transition-colors", isChildActive ? "font-medium text-foreground" : "text-sidebar-foreground")}>{item.title}</span>
          <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform duration-300 in-data-panel-open:rotate-90 in-aria-expanded:rotate-90 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
          <SidebarMenuSub>
            {item.children!.map((child) => {
              const isSubActive = activeUrl === child.url || activeUrl.startsWith(`${child.url}/`)
              return (
                <SidebarMenuSubItem key={child.url}>
                  <SidebarMenuSubButton
                    isActive={isSubActive}
                    className={cn(buttonMotion, "relative")}
                    render={
                      <Link
                        to={child.url}
                        onPointerEnter={() => preloadPage(child.url)}
                        onFocus={() => preloadPage(child.url)}
                        onTouchStart={() => preloadPage(child.url)}
                      />
                    }
                  >
                    {isSubActive && <ActivePill />}
                    <span className={cn("transition-colors", isSubActive ? "font-medium text-primary" : "text-sidebar-foreground")}>{child.title}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

function NavUser({ onLogout }: { onLogout?: () => void }) {
  const { user } = useAuth()
  const { isMobile, state } = useSidebar()
  const [prefOpen, setPrefOpen] = React.useState(false)

  if (!user) return null

  const displayName = user.nickname || user.username
  const initials = (displayName[0] || "U").toUpperCase()
  const roleNames = user.roles?.map((r) => r.name).join("、") || user.email || "系统用户"
  const isCollapsed = state === "collapsed" && !isMobile

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              openOnHover={isCollapsed}
              delay={70}
              closeDelay={140}
              render={
                <SidebarMenuButton
                  size="lg"
                  tooltip={undefined}
                  className="transition-[width,height,padding,background-color,transform] duration-200 ease-out active:scale-[0.98] data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground motion-reduce:transition-none"
                />
              }
            >
              <Avatar className="size-8 rounded-lg">
                {user.avatar && <AvatarImage src={user.avatar} alt={displayName} />}
                <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{roleNames}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-60 rounded-xl duration-200 border border-border/80 shadow-lg"
              side={isMobile ? "bottom" : isCollapsed ? "right" : "top"}
              align={isCollapsed ? "end" : "center"}
              sideOffset={8}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2.5 px-2 py-2 text-left text-sm">
                    <Avatar className="size-8 rounded-lg">
                      {user.avatar && <AvatarImage src={user.avatar} alt={displayName} />}
                      <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-semibold">{displayName}</span>
                        <AuthSourceBadge authType={user.auth_type} />
                      </div>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {user.username}{user.domain ? `@${user.domain}` : ""}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPrefOpen(true)}>
                <Settings className="size-4" />
                偏好与会话设置
              </DropdownMenuItem>
              {onLogout && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onLogout}>
                    <LogOut className="size-4 text-destructive" />
                    <span className="text-destructive">退出登录</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <UserPreferencesDialog open={prefOpen} onOpenChange={setPrefOpen} />
    </>
  )
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onLogout?: () => void
}

export function AppSidebar({ onLogout, ...props }: AppSidebarProps) {
  const location = useLocation()
  const { can } = useAuth()

  const groups = React.useMemo(() => {
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items
          .map((item) => {
            if (item.children) {
              const allowedChildren = item.children.filter((child) => can(child.permission))
              return { ...item, children: allowedChildren }
            }
            return item
          })
          .filter((item) => {
            if (item.children) return item.children.length > 0
            return can(item.permission)
          }),
      }))
      .filter((group) => group.items.length > 0)
  }, [can])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="h-10" render={<Link to="/" />}>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-sm ring-1 ring-primary/20">
                <Layers className="size-4.5" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">InfraNexus</span>
                <span className="font-mono text-[10px] text-muted-foreground">Enterprise Console</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavMenuItem key={item.url} item={item} activeUrl={location.pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser onLogout={onLogout} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
