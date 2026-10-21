import { Outlet, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { notify } from "@/lib/notify"
import { useAuth } from "@/stores/auth-context"
import { AppSidebar } from "./app-sidebar"
import { Header } from "./header"

export function AdminLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { logout } = useAuth()

  const handleLogout = async () => {
    try {
      await logout()
      queryClient.clear()
      navigate("/login", { replace: true })
    } catch (error) {
      notify.apiError(error, "退出失败，服务器尚未确认会话已撤销")
    }
  }

  return (
    <SidebarProvider className="h-svh w-full overflow-hidden">
      <AppSidebar />
      <SidebarInset className="flex h-svh w-full flex-col overflow-hidden bg-slate-100/60 dark:bg-background">
        <Header onLogout={handleLogout} />
        <main className="w-full flex-1 overflow-x-hidden overflow-y-auto bg-slate-100/60 dark:bg-background">
          <div className="w-full space-y-5 p-4 md:p-6 2xl:px-8">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
