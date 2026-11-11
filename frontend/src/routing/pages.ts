import { lazy, type ComponentType } from "react"

function preloadable(load: () => Promise<{ default: ComponentType }>) {
  let pending: ReturnType<typeof load> | undefined
  const preload = () => (pending ??= load().catch((error: unknown) => {
    pending = undefined
    throw error
  }))
  return { Page: lazy(preload), preload }
}

export const routePages = {
  "/dashboard": preloadable(() => import("@/pages/dashboard/index")),
  "/users": preloadable(() => import("@/pages/users/index")),
  "/departments": preloadable(() => import("@/pages/departments/index")),
  "/roles": preloadable(() => import("@/pages/roles/index")),
  "/permissions": preloadable(() => import("@/pages/permissions/index")),
  "/ldap": preloadable(() => import("@/pages/ldap/index")),

  // DCIM Foundation Modules
  "/vendor-management": preloadable(() => import("@/pages/vendor-management/index")),
  "/locations": preloadable(() => import("@/pages/locations/index")),
  "/locations/topology": preloadable(() => import("@/pages/locations/index")),
  "/locations/warehouses": preloadable(() => import("@/pages/locations/warehouses")),
  "/ipam/subnets": preloadable(() => import("@/pages/ipam/index")),
}

export function preloadPage(pathname: string) {
  const route = routePages[pathname as keyof typeof routePages]
  // Speculative loading must not surface an unhandled rejection.
  if (route) void route.preload().catch(() => {})
}
