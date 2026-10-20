import React, { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useAuth } from "@/stores/auth-context";

export const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState("");

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login");
    } catch {
      setLogoutError("退出失败，服务器尚未确认会话已撤销，请重试。");
    }
  };

  const headerUserData = user
    ? {
        username: user.username,
        nickname: user.nickname,
        roles: user.roles?.map((r) => r.code) || ["admin"],
      }
    : {
        username: "admin",
        nickname: "系统管理员",
        roles: ["admin"],
      };

  return (
    <SidebarProvider className="h-svh w-full overflow-hidden">
      <AppSidebar />
      <SidebarInset className="flex flex-col h-svh w-full overflow-hidden bg-background">
        {/* 顶部功能区：固定在顶部，绝对不随页面滚动 */}
        <Header currentUser={headerUserData} onLogout={handleLogout} />
        {logoutError && (
          <div
            role="alert"
            className="bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            {logoutError}
          </div>
        )}

        {/* 主内容区域：流式全宽无缩水画布，主内容独立纵向滚动 */}
        <main className="flex-1 w-full overflow-y-auto overflow-x-hidden p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};
