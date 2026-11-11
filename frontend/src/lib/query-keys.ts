import type { UserListParams } from "@/services/users"
import type { RoleListParams } from "@/services/roles"
import type { ManagedQueryParams } from "@/services/managed"

export const queryKeys = {
  users: (params: UserListParams) => ["users", "list", params] as const,
  usersAll: ["users"] as const,
  userStats: ["users", "stats"] as const,
  departmentTree: ["departments", "tree"] as const,
  roleOptions: ["options", "roles"] as const,
  departmentOptions: ["options", "departments"] as const,
  roles: (params: RoleListParams) => ["roles", "list", params] as const,
  rolesAll: ["roles"] as const,
  permissions: ["permissions"] as const,
  ldapConfigs: ["ldap", "configs"] as const,
  ldapLogs: (configId?: string) => ["ldap", "logs", configId ?? "all"] as const,
  loginDomains: ["auth", "domains"] as const,
  dashboard: ["dashboard"] as const,

  // Vendor Management
  manufacturers: (params?: ManagedQueryParams) => ["manufacturers", "list", params] as const,
  manufacturersAll: ["manufacturers"] as const,
  vendors: (params?: ManagedQueryParams) => ["vendors", "list", params] as const,
  vendorsAll: ["vendors"] as const,
  contacts: (params?: ManagedQueryParams) => ["contacts", "list", params] as const,
  contactsAll: ["contacts"] as const,
  qualifications: (params?: ManagedQueryParams) => ["qualifications", "list", params] as const,
  qualificationsAll: ["qualifications"] as const,
  certifications: (params?: ManagedQueryParams) => ["certifications", "list", params] as const,
  certificationsAll: ["certifications"] as const,

  // Locations
  datacenters: (params?: ManagedQueryParams) => ["datacenters", "list", params] as const,
  datacentersAll: ["datacenters"] as const,
  buildings: (params?: ManagedQueryParams) => ["buildings", "list", params] as const,
  buildingsAll: ["buildings"] as const,
  floors: (params?: ManagedQueryParams) => ["floors", "list", params] as const,
  floorsAll: ["floors"] as const,
  rooms: (params?: ManagedQueryParams) => ["rooms", "list", params] as const,
  roomsAll: ["rooms"] as const,
  rackRows: (params?: ManagedQueryParams) => ["rack-rows", "list", params] as const,
  rackRowsAll: ["rack-rows"] as const,
  racks: (params?: ManagedQueryParams) => ["racks", "list", params] as const,
  racksAll: ["racks"] as const,
  rackUnits: (rackId: string) => ["racks", "units", rackId] as const,
  warehouses: (params?: ManagedQueryParams) => ["warehouses", "list", params] as const,
  warehousesAll: ["warehouses"] as const,
  shelves: (params?: ManagedQueryParams) => ["shelves", "list", params] as const,
  shelvesAll: ["shelves"] as const,
  bins: (params?: ManagedQueryParams) => ["bins", "list", params] as const,
  binsAll: ["bins"] as const,
  temporaryLocations: (params?: ManagedQueryParams) => ["temporary-locations", "list", params] as const,
  temporaryLocationsAll: ["temporary-locations"] as const,

  // IPAM
  networkScopes: (params?: ManagedQueryParams) => ["network-scopes", "list", params] as const,
  networkScopesAll: ["network-scopes"] as const,
  securityZones: (params?: ManagedQueryParams) => ["security-zones", "list", params] as const,
  securityZonesAll: ["security-zones"] as const,
  subnets: (params?: ManagedQueryParams) => ["subnets", "list", params] as const,
  subnetsAll: ["subnets"] as const,
  subnetAddresses: (subnetId: string, page?: number, pageSize?: number) =>
    ["subnets", "addresses", subnetId, page, pageSize] as const,
}
