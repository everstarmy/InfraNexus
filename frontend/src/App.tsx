import React, { Suspense, lazy } from "react"
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router-dom"
import { Layers, RotateCcw, WifiOff } from "lucide-react"
import { AdminLayout } from "@/layouts/admin-layout"
import { pageNavItems } from "@/layouts/nav-config"
import { AuthProvider, useAuth } from "@/stores/auth-context"
import { NotificationsProvider } from "@/stores/notifications"
import { RequirePermission } from "@/components/common/require-permission"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { routePages } from "@/routing/pages"
import { RouteError } from "@/routing/route-error"
import { RoutePage, RoutePageSkeleton } from "@/routing/route-page"
import ForbiddenPage from "@/pages/errors/forbidden"

const LoginPage = lazy(() => import("@/pages/auth/login"))

function PageLoader() {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
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
  const first = pageNavItems.find((item) => can(item.permission))
  if (!first) return <ForbiddenPage description="当前账号尚未分配任何菜单权限，请联系管理员为你的角色授权。" />
  return <Navigate to={first.url} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationsProvider>
        <Suspense fallback={<PageLoader />}>
          <RouterProvider router={router} />
        </Suspense>
      </NotificationsProvider>
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  { path: "/login", element: <Suspense fallback={<PageLoader />}><LoginPage /></Suspense>, errorElement: <RouteError fullscreen /> },
  {
    path: "/",
    errorElement: <RouteError fullscreen />,
    element: (
      <ProtectedRoute>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      ...pageNavItems.map((item) => {
        const { Page } = routePages[item.url as keyof typeof routePages]
        return {
          path: item.url.replace(/^\//, ""),
          errorElement: <RouteError />,
          element: (
            <RequirePermission code={item.permission}>
              <Suspense fallback={<RoutePageSkeleton />}>
                <RoutePage key={item.url}><Page /></RoutePage>
              </Suspense>
            </RequirePermission>
          ),
        }
      }),
      { path: "403", element: <ForbiddenPage /> },
      { path: "*", element: <HomeRedirect /> },
    ],
  },
])
