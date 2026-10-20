import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sun,
  Moon,
  Search,
  Bell,
  LogOut,
  User as UserIcon,
  Shield,
  LayoutDashboard,
  Users,
  CheckCheck,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import { setTheme } from "@/lib/theme";

interface HeaderProps {
  currentUser?: {
    username: string;
    nickname?: string;
    roles?: string[];
  } | null;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onLogout,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);

    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    setTheme(nextDark ? "dark" : "light");
  };

  // 根据当前路由生成面包屑名称
  const getPageTitle = () => {
    switch (location.pathname) {
      case "/dashboard":
        return "仪表盘";
      case "/users":
        return "用户管理";
      case "/roles":
        return "角色管理";
      case "/permissions":
        return "权限清单";
      default:
        return "管理控制台";
    }
  };

  const handleSelectNav = (path: string) => {
    setSearchOpen(false);
    navigate(path);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 w-full items-center justify-between border-b border-border bg-background/95 px-4 md:px-6 backdrop-blur-xs">
      {/* 左侧：官方 SidebarTrigger 侧栏切换手柄 + 垂直分隔符 + 官方 Breadcrumb */}
      <div className="flex items-center gap-2.5">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />

        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden sm:inline-flex">
              <BreadcrumbLink
                className="cursor-pointer"
                onClick={() => navigate("/dashboard")}
              >
                工作台
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold text-foreground">
                {getPageTitle()}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* 右侧：全局搜索、通知中心、明暗主题与用户头像 */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* 全局快捷搜索触发器 (shadcn 规范 + Kbd) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSearchOpen(true)}
          className="relative hidden md:flex h-8 w-48 xl:w-64 items-center justify-between rounded-lg border-input bg-muted/30 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground shadow-none"
        >
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" />
            <span className="truncate">快速搜索功能...</span>
          </div>
          <Kbd className="h-4.5 px-1.5 text-[10px]">⌘K</Kbd>
        </Button>

        {/* 官方 CommandDialog 命令面板 */}
        <CommandDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          title="全局功能导航"
          description="输入关键词快速跳转页面或执行快捷操作"
        >
          <Command>
            <CommandInput placeholder="输入页面或功能名称..." />
            <CommandList>
              <CommandEmpty>未找到相关功能或页面。</CommandEmpty>
              <CommandGroup heading="工作台导航">
                <CommandItem onSelect={() => handleSelectNav("/dashboard")}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  <span>系统监控仪表盘</span>
                  <CommandShortcut>G D</CommandShortcut>
                </CommandItem>
                <CommandItem onSelect={() => handleSelectNav("/users")}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>用户账号管理</span>
                  <CommandShortcut>G U</CommandShortcut>
                </CommandItem>
                <CommandItem onSelect={() => handleSelectNav("/roles")}>
                  <Shield className="mr-2 h-4 w-4" />
                  <span>安全角色与权限分配</span>
                  <CommandShortcut>G R</CommandShortcut>
                </CommandItem>
                <CommandItem onSelect={() => handleSelectNav("/permissions")}>
                  <CheckCheck className="mr-2 h-4 w-4" />
                  <span>系统权限清单与资源点</span>
                  <CommandShortcut>G P</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="快捷偏好">
                <CommandItem
                  onSelect={() => {
                    toggleTheme();
                    setSearchOpen(false);
                  }}
                >
                  {isDark ? <Sun className="mr-2 h-4 w-4 text-amber-400" /> : <Moon className="mr-2 h-4 w-4" />}
                  <span>切换至{isDark ? "浅色模式" : "深色模式"}</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setSearchOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4 text-destructive" />
                  <span className="text-destructive">退出登录</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </CommandDialog>

        {/* 官方 Popover 实时通知面板 */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
                title="实时系统通知"
              />
            }
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h4 className="text-sm font-semibold">系统实时通知</h4>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-mono">
                SSE 在线
              </span>
            </div>
            <div className="space-y-2.5 pt-3 text-xs">
              <div className="rounded-lg bg-muted/50 p-2.5 border border-border/50">
                <p className="font-medium text-foreground">双驱动持久化就绪</p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  SQLite 与 PostgreSQL 连接池已初始化，支持毫秒级无感降级。
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-2.5 border border-border/50">
                <p className="font-medium text-foreground">Casbin RBAC 策略生效中</p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  细粒度路由鉴权拦截器正在保护系统核心 API。
                </p>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* 主题切换 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title={isDark ? "切换至浅色模式" : "切换至深色模式"}
        >
          {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* 用户个人菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="relative h-9 flex items-center gap-2.5 rounded-full pl-1.5 pr-3 hover:bg-accent border border-transparent hover:border-border/60 transition-colors"
              />
            }
          >
            <Avatar className="h-7 w-7 border border-border shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
                {currentUser?.nickname?.[0] || currentUser?.username?.[0]?.toUpperCase() || "A"}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-semibold leading-tight text-foreground truncate max-w-[120px]">
                {currentUser?.nickname || currentUser?.username || "管理员"}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight capitalize mt-0.5">
                {currentUser?.roles?.[0] || "admin"}
              </span>
            </div>
            <ChevronDown className="hidden md:block h-3.5 w-3.5 text-muted-foreground/70 shrink-0 ml-0.5" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none text-foreground">
                    {currentUser?.nickname || currentUser?.username || "管理员"}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {currentUser?.username || "admin"}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/users")}>
                <UserIcon className="mr-2 h-4 w-4" />
                <span>用户中心</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/roles")}>
                <Shield className="mr-2 h-4 w-4" />
                <span>角色权限</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
