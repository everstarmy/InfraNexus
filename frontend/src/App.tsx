import React, { Suspense, lazy } from "react"
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Layers, RotateCcw, WifiOff } from "lucide-react"
import { AdminLayout } from "@/layouts/admin-layout"
import { navItems } from "@/layouts/nav-config"
import { AuthProvider, useAuth } from "@/stores/auth-context"
import { NotificationsProvider } from "@/stores/notifications"
import { RequirePermission } from "@/components/common/require-permission"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import ForbiddenPage from "@/pages/errors/forbidden"

const DashboardPage = lazy(() => import("@/pages/dashboard/index"))
const UsersPage = lazy(() => import("@/pages/users/index"))
const DepartmentsPage = lazy(() => import("@/pages/departments/index"))
const RolesPage = lazy(() => import("@/pages/roles/index"))
const PermissionsPage = lazy(() => import("@/pages/permissions/index"))
const LdapPage = lazy(() => import("@/pages/ldap/index"))
const LoginPage = lazy(() => import("@/pages/auth/login"))

const pages: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  "/dashboard": DashboardPage,
  "/users": UsersPage,
  "/departments": DepartmentsPage,
  "/roles": RolesPage,
  "/permissions": PermissionsPage,
  "/ldap": LdapPage,
}

function PageLoader() {
  return (
    <div className="flex h-64 w-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      <Spinner className="size-5 text-primary" />
      正在加载模块…
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, authError, checkAuth } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-svh w-full flex-col items-center justify-center gap-4 bg-background">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-lg motion-safe:animate-pulse">
          <Layers className="size-6" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="text-primary" />
          正在校验安全会话…
        </div>
      </div>
    )
  }

  if (authError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Empty className="max-w-md border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WifiOff />
            </EmptyMedia>
            <EmptyTitle>无法验证登录状态</EmptyTitle>
            <EmptyDescription>{authError}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => void checkAuth()}>
              <RotateCcw />
              重试
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  return <>{children}</>
}

function HomeRedirect() {
  const { can } = useAuth()
  const first = navItems.find((item) => can(item.permission))
  if (!first) return <ForbiddenPage description="当前账号尚未分配任何菜单权限，请联系管理员为你的角色授权。" />
  return <Navigate to={first.url} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationsProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <ProtectedRoute>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<HomeRedirect />} />
                {navItems.map((item) => {
                  const Page = pages[item.url]
                  return (
                    <Route
                      key={item.url}
                      path={item.url}
                      element={
                        <RequirePermission code={item.permission}>
                          <Suspense fallback={<PageLoader />}>
                            <Page />
                          </Suspense>
                        </RequirePermission>
                      }
                    />
                  )
                })}
                <Route path="/403" element={<ForbiddenPage />} />
                <Route path="*" element={<HomeRedirect />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </NotificationsProvider>
    </AuthProvider>
  )
}
