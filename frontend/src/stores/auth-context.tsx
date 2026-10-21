import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { authService, type CurrentUser } from "@/services/auth"
import type { UserPreferences } from "@/services/types"
import { getErrorStatus } from "@/lib/api-error"
import { hasPermission } from "@/lib/permissions"

interface AuthContextType {
  user: CurrentUser | null
  loading: boolean
  authError: string | null
  isAuthenticated: boolean
  login: (user: CurrentUser) => void
  logout: () => Promise<void>
  checkAuth: () => Promise<boolean>
  can: (code: string | readonly string[]) => boolean
  updateUserPreferences: (pref: Partial<UserPreferences>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const checkAuth = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    try {
      const res = await authService.getProfile()
      setUser(res.data)
      setAuthError(null)
      return true
    } catch (error) {
      const status = getErrorStatus(error)
      if (status === 401 || status === 403) {
        setUser(null)
        setAuthError(null)
      } else setAuthError("暂时无法验证登录状态，请检查网络后重试。")
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void checkAuth()
  }, [checkAuth])

  useEffect(() => {
    const clear = () => {
      setUser(null)
      setAuthError(null)
    }
    window.addEventListener("infranexus:unauthorized", clear)
    return () => window.removeEventListener("infranexus:unauthorized", clear)
  }, [])

  const login = useCallback((value: CurrentUser) => {
    setUser(value)
    setAuthError(null)
  }, [])

  const logout = useCallback(async () => {
    await authService.logout()
    setUser(null)
    setAuthError(null)
  }, [])

  const can = useCallback(
    (code: string | readonly string[]) => hasPermission(user?.permissions, code),
    [user],
  )

  const updateUserPreferences = useCallback((pref: Partial<UserPreferences>) => {
    setUser((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        preferences: {
          ...prev.preferences,
          ...pref,
        },
      }
    })
  }, [])

  const value = useMemo(
    () => ({ user, loading, authError, isAuthenticated: !!user, login, logout, checkAuth, can, updateUserPreferences }),
    [user, loading, authError, login, logout, checkAuth, can, updateUserPreferences],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
