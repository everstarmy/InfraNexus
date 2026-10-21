import * as React from "react"
import { Link, useLocation } from "react-router-dom"
import { Layers, Radio } from "lucide-react"
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
  SidebarRail,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { useAuth } from "@/stores/auth-context"
import { useNotifications } from "@/stores/notifications"
import { preloadPage } from "@/routing/pages"
import { navGroups } from "./nav-config"

const statusText = { online: "实时通道已连接", connecting: "实时通道重连中", offline: "实时通道离线" } as const

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation()
  const { can } = useAuth()
  const { status } = useNotifications()
  const groups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => can(item.permission)) }))
    .filter((group) => group.items.length > 0)

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
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
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const isActive = location.pathname === item.url || location.pathname.startsWith(`${item.url}/`)
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        render={<Link to={item.url} onPointerEnter={() => preloadPage(item.url)} onFocus={() => preloadPage(item.url)} onTouchStart={() => preloadPage(item.url)} />}
                        isActive={isActive}
                        tooltip={item.title}
                        className={cn(
                          "transition-all duration-150",
                          isActive
                            ? "font-medium text-sidebar-foreground bg-sidebar-accent shadow-2xs"
                            : "text-muted-foreground hover:text-sidebar-foreground",
                        )}
                      >
                        <Icon className={cn("size-4 shrink-0 transition-colors", isActive && "text-primary")} />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
          <Radio
            className={cn(
              "size-3 shrink-0",
              status === "online" ? "text-emerald-500 motion-safe:animate-pulse" : status === "connecting" ? "text-amber-500" : "text-muted-foreground",
            )}
          />
          <span className="truncate group-data-[collapsible=icon]:hidden">{statusText[status]}</span>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
