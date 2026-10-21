import { useEffect, useRef } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { notify } from "@/lib/notify"
import { useAuth } from "@/stores/auth-context"
import { AppSidebar } from "./app-sidebar"
import { Header } from "./header"

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { logout } = useAuth()
  const mainRef = useRef<HTMLElement>(null)

  // 方案 2：路由路径改变时，视口滚动容器瞬间复位至顶部，消除跨页面的滚动残留
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "instant" })
  }, [location.pathname])

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
        <main ref={mainRef} className="w-full flex-1 overflow-x-hidden overflow-y-auto bg-slate-100/60 dark:bg-background">
          {/* 方案 1：页面级微动效转场 (Fade + 微位移)，以 location.pathname 为 key 触发，参数变化不引起重播 */}
          <div
            key={location.pathname}
            className="w-full space-y-5 p-4 md:p-6 2xl:px-8 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 duration-200 ease-out"
          >
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
