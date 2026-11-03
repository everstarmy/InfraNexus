import type React from "react"
import { useAuth } from "@/stores/auth-context"
import ForbiddenPage from "@/pages/errors/forbidden"

export function RequirePermission({ code, children }: { code: string; children: React.ReactNode }) {
  const { can } = useAuth()
  if (!can(code)) return <ForbiddenPage />
  return <>{children}</>
}
