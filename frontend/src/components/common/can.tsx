import type React from "react"
import { useAuth } from "@/stores/auth-context"

export function Can({
  code,
  fallback = null,
  children,
}: {
  code: string | readonly string[]
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  const { can } = useAuth()
  return <>{can(code) ? children : fallback}</>
}
