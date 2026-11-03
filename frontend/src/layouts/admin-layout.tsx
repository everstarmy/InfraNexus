import { useRef } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { MotionConfig } from "motion/react"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { notify } from "@/lib/notify"
import { useAuth } from "@/stores/auth-context"
import { AppSidebar } from "./app-sidebar"
import { useMainScroll } from "@/routing/use-main-scroll"
import { Header } from "./header"
import { UnsavedChangesProvider } from "@/hooks/use-unsaved-changes"

export function AdminLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { logout } = useAuth()
  const mainRef = useRef<HTMLElement>(null)

  useMainScroll(mainRef)

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
    <UnsavedChangesProvider>
      <MotionConfig reducedMotion="user">
        <SidebarProvider className="h-svh w-full overflow-hidden">
          <AppSidebar onLogout={handleLogout} />
          <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background ring-1 ring-border/75 dark:bg-background dark:ring-border">
            <Header onLogout={handleLogout} />
            <main ref={mainRef} className="w-full flex-1 overflow-x-hidden overflow-y-auto">
              <div className="admin-page-content flex w-full flex-col gap-2 p-2.5 sm:p-3">
                <Outlet />
              </div>
            </main>
          </SidebarInset>
        </SidebarProvider>
      </MotionConfig>
    </UnsavedChangesProvider>
  )
}
