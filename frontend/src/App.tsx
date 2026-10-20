import React, { Suspense, lazy } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { Layers, Loader2 } from "lucide-react";
import { AdminLayout } from "@/layouts/admin-layout";
import { AuthProvider, useAuth } from "@/stores/auth-context";

// 路由代码分割按需懒加载 (Code Splitting)
const DashboardPage = lazy(() => import("@/pages/dashboard/index"));
const UsersPage = lazy(() => import("@/pages/users/index"));
const RolesPage = lazy(() => import("@/pages/roles/index"));
const PermissionsPage = lazy(() => import("@/pages/permissions/index"));
const LoginPage = lazy(() => import("@/pages/auth/login"));

function PageLoader() {
  return (
    <div className="flex h-64 w-full flex-col items-center justify-center gap-2">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span className="text-xs text-muted-foreground">正在加载模块视图...</span>
    </div>
  );
}

// 权限路由守卫：拦截未登录访问，校验通过前渲染优雅加载屏，未登录自动跳转 /login 并记录来源
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, authError, checkAuth } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background text-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground animate-pulse shadow-md">
          <Layers className="h-6 w-6" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>正在校验凭据安全会话...</span>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="p-6" role="alert">
        {authError}{" "}
        <button onClick={() => void checkAuth()} className="underline">
          重试
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* 公开登录页 */}
            <Route path="/login" element={<LoginPage />} />

            {/* 根路径默认重定向 */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* SaaS 受保护主工作区 */}
            <Route
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/roles" element={<RolesPage />} />
              <Route path="/permissions" element={<PermissionsPage />} />
            </Route>

            {/* 404 兜底路由 */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
