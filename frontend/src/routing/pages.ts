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

  // Model Management, Arrival Orders, Receiving & Physical Assets
  "/model-management/component-models": preloadable(() => import("@/pages/model-management/component-models")),
  "/model-management/device-models": preloadable(() => import("@/pages/model-management/device-models")),
  "/arrival-orders": preloadable(() => import("@/pages/arrival-orders/index")),
  "/receipts": preloadable(() => import("@/pages/receipts/index")),
  "/assets/devices": preloadable(() => import("@/pages/assets/devices")),
  "/assets/components": preloadable(() => import("@/pages/assets/components")),
}

export const detailRoutePages = [
  {
    path: "model-management/component-models/:id",
    permission: "model-management:component-models:read",
    ...preloadable(() => import("@/pages/model-management/component-model-detail")),
  },
  {
    path: "model-management/device-models/:id",
    permission: "model-management:device-models:read",
    ...preloadable(() => import("@/pages/model-management/device-model-detail")),
  },
  {
    path: "arrival-orders/:id",
    permission: "arrival-orders:read",
    ...preloadable(() => import("@/pages/arrival-orders/detail")),
  },
  {
    path: "receipts/:id",
    permission: "receipts:read",
    ...preloadable(() => import("@/pages/receipts/detail")),
  },
  {
    path: "assets/devices/:id",
    permission: "assets:devices:read",
    ...preloadable(() => import("@/pages/assets/device-detail")),
  },
  {
    path: "assets/components/:id",
    permission: "assets:components:read",
    ...preloadable(() => import("@/pages/assets/component-detail")),
  },
] as const

export function preloadPage(pathname: string) {
  const route = routePages[pathname as keyof typeof routePages]
  // Speculative loading must not surface an unhandled rejection.
  if (route) void route.preload().catch(() => {})
}
