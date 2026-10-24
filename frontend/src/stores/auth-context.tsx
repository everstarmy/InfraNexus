import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { authService, type CurrentUser } from "@/services/auth"
import type { UserPreferences } from "@/services/types"
import { getErrorStatus } from "@/lib/api-error"
import { hasPermission } from "@/lib/permissions"
import { useQueryClient } from "@tanstack/react-query"

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
  const queryClient = useQueryClient()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const userRef = React.useRef<CurrentUser | null>(null)
  const generation = React.useRef(0)
  const backgroundRefresh = React.useRef(false)
  const lastRefresh = React.useRef(0)
  userRef.current = user

  const clearSensitiveState = useCallback(() => {
    generation.current += 1
    userRef.current = null
    setUser(null)
    setAuthError(null)
    setLoading(false)
    void queryClient.cancelQueries()
    queryClient.clear()
  }, [queryClient])

  const checkAuth = useCallback(async (): Promise<boolean> => {
    const currentGeneration = ++generation.current
    setLoading(true)
    try {
      const res = await authService.getProfile()
      if (currentGeneration !== generation.current) return false
      const previous = userRef.current
      if (previous && previous.id !== res.data.id) {
        await queryClient.cancelQueries()
        if (currentGeneration !== generation.current) return false
        queryClient.clear()
      }
      userRef.current = res.data
      setUser(res.data)
      setAuthError(null)
      lastRefresh.current = Date.now()
      return true
    } catch (error) {
      if (currentGeneration !== generation.current) return false
      const status = getErrorStatus(error)
      if (status === 401 || status === 403) {
        clearSensitiveState()
      } else setAuthError("暂时无法验证登录状态，请检查网络后重试。")
      return false
    } finally {
      if (currentGeneration === generation.current) setLoading(false)
    }
  }, [clearSensitiveState, queryClient])

  useEffect(() => {
    void checkAuth()
  }, [checkAuth])

  useEffect(() => {
    window.addEventListener("infranexus:unauthorized", clearSensitiveState)
    return () => window.removeEventListener("infranexus:unauthorized", clearSensitiveState)
  }, [clearSensitiveState])

  // Revalidate permissions without switching ProtectedRoute to its loading screen.
  useEffect(() => {
    const refresh = async () => {
      if (!userRef.current || document.visibilityState === "hidden" || backgroundRefresh.current || Date.now() - lastRefresh.current < 5000) return
      const currentGeneration = generation.current
      lastRefresh.current = Date.now()
      backgroundRefresh.current = true
      try {
        const res = await authService.getProfile()
        if (currentGeneration !== generation.current) return
        if (res.data.id !== userRef.current?.id) {
          clearSensitiveState()
          return
        }
        userRef.current = res.data
        setUser(res.data)
      } catch (error) {
        if (currentGeneration === generation.current && getErrorStatus(error) === 401) clearSensitiveState()
      } finally {
        backgroundRefresh.current = false
      }
    }
    const onVisible = () => { if (document.visibilityState === "visible") void refresh() }
    const onRefresh = () => { void refresh() }
    window.addEventListener("focus", onRefresh)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("infranexus:permissions-stale", onRefresh)
    return () => {
      window.removeEventListener("focus", onRefresh)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("infranexus:permissions-stale", onRefresh)
    }
  }, [clearSensitiveState])

  const login = useCallback((value: CurrentUser) => {
    if (userRef.current && userRef.current.id !== value.id) queryClient.clear()
    generation.current += 1
    lastRefresh.current = Date.now()
    userRef.current = value
    setUser(value)
    setAuthError(null)
  }, [queryClient])

  const logout = useCallback(async () => {
    await authService.logout()
    clearSensitiveState()
  }, [clearSensitiveState])

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
