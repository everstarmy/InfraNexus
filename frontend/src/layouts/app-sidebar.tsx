import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  KeyRound,
  Layers,
  Radio,
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";

const navItems = [
  {
    title: "仪表盘",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "用户管理",
    url: "/users",
    icon: Users,
  },
  {
    title: "角色管理",
    url: "/roles",
    icon: ShieldCheck,
  },
  {
    title: "权限清单",
    url: "/permissions",
    icon: KeyRound,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation();

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* 头部 Branding */}
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" className="flex items-center gap-3" />}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Layers className="h-4.5 w-4.5" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">
                  InfraNexus
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  Cloud Native SaaS
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* 侧栏主体导航 */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>核心工作台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  location.pathname === item.url ||
                  location.pathname.startsWith(`${item.url}/`);

                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      render={<Link to={item.url} />}
                      isActive={isActive}
                      tooltip={item.title}
                      className={isActive ? "font-medium" : "text-muted-foreground"}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* 底部状态指示 */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
              <Radio className="h-3 w-3 text-emerald-500 animate-pulse shrink-0" />
              <span className="truncate group-data-[collapsible=icon]:hidden">
                GoFiber v3 + Casbin
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* 侧栏拖动/点击 Rail 折叠手柄 */}
      <SidebarRail />
    </Sidebar>
  );
}
