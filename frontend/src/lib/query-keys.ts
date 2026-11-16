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
  companies: (params?: ManagedQueryParams) => ["companies", "list", params] as const,
  companiesAll: ["companies"] as const,
  companyContacts: (companyId: string, params?: ManagedQueryParams) =>
    ["company-contacts", "list", companyId, params] as const,
  companyContactsAll: ["company-contacts"] as const,

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

  // Asset Receiving, Catalog & Physical Assets
  receivingMetadata: ["receiving", "metadata"] as const,
  publishedDeviceRevisions: ["receiving", "published-device-revisions"] as const,
  publishedComponentRevisions: ["receiving", "published-component-revisions"] as const,
  selectableDeviceModels: ["receiving", "selectable-device-models"] as const,
  selectableDeviceRevisionsAll: ["receiving", "selectable-device-revisions"] as const,
  selectableDeviceRevisions: (modelId: string) =>
    ["receiving", "selectable-device-revisions", modelId] as const,
  componentModelsAll: ["receiving", "component-models"] as const,
  componentModels: (params?: Record<string, unknown>) => ["receiving", "component-models", "list", params] as const,
  componentModel: (id: string) => ["receiving", "component-models", "detail", id] as const,
  componentModelRevisions: (id: string, params?: Record<string, unknown>) =>
    ["receiving", "component-models", "revisions", id, params] as const,
  componentModelRevision: (id: string, revId: string) =>
    ["receiving", "component-models", "revision", id, revId] as const,
  componentModelReferences: (id: string) => ["receiving", "component-models", "references", id] as const,
  componentModelHistory: (id: string, page?: number) => ["receiving", "component-models", "history", id, page] as const,

  deviceModelsAll: ["receiving", "device-models"] as const,
  deviceModels: (params?: Record<string, unknown>) => ["receiving", "device-models", "list", params] as const,
  deviceModel: (id: string) => ["receiving", "device-models", "detail", id] as const,
  deviceModelRevisionsAll: (id: string) => ["receiving", "device-models", "revisions", id] as const,
  deviceModelRevisions: (id: string, params?: Record<string, unknown>) =>
    ["receiving", "device-models", "revisions", id, params] as const,
  deviceModelRevision: (id: string, revId: string) =>
    ["receiving", "device-models", "revision", id, revId] as const,
  deviceModelCompatibleComponentsAll: (id: string, revId: string) =>
    ["receiving", "device-models", "compatible-components", id, revId] as const,
  deviceModelCompatibleComponents: (id: string, revId: string, params?: Record<string, unknown>) =>
    ["receiving", "device-models", "compatible-components", id, revId, params] as const,
  deviceModelReferences: (id: string) => ["receiving", "device-models", "references", id] as const,
  deviceModelHistory: (id: string, page?: number) => ["receiving", "device-models", "history", id, page] as const,

  arrivalOrdersAll: ["receiving", "arrival-orders"] as const,
  arrivalOrders: (params?: Record<string, unknown>) => ["receiving", "arrival-orders", "list", params] as const,
  arrivalOrder: (id: string) => ["receiving", "arrival-orders", "detail", id] as const,
  arrivalOrderLines: (id: string) => ["receiving", "arrival-orders", "lines", id] as const,
  arrivalOrderHistory: (id: string, page?: number) => ["receiving", "arrival-orders", "history", id, page] as const,

  receiptsAll: ["receiving", "receipts"] as const,
  receipts: (params?: Record<string, unknown>) => ["receiving", "receipts", "list", params] as const,
  receipt: (id: string) => ["receiving", "receipts", "detail", id] as const,
  receiptItems: (id: string, params?: Record<string, unknown>) => ["receiving", "receipts", "items", id, params] as const,
  receiptItemComponents: (id: string, itemId: string, params?: Record<string, unknown>) =>
    ["receiving", "receipts", "components", id, itemId, params] as const,
  receiptItemPhotos: (id: string, itemId: string) => ["receiving", "receipts", "photos", id, itemId] as const,
  receiptResult: (id: string) => ["receiving", "receipts", "result", id] as const,
  receiptResultItems: (id: string, params?: Record<string, unknown>) =>
    ["receiving", "receipts", "result-items", id, params] as const,
  receiptHistory: (id: string, page?: number) => ["receiving", "receipts", "history", id, page] as const,

  assetDevicesAll: ["receiving", "asset-devices"] as const,
  assetDevices: (params?: Record<string, unknown>) => ["receiving", "asset-devices", "list", params] as const,
  assetDevice: (id: string) => ["receiving", "asset-devices", "detail", id] as const,
  assetDeviceHistory: (id: string, page?: number) => ["receiving", "asset-devices", "history", id, page] as const,
  assetDeviceOriginal: (id: string) => ["receiving", "asset-devices", "original", id] as const,
  assetDeviceOriginalItems: (id: string, params?: Record<string, unknown>) =>
    ["receiving", "asset-devices", "original-items", id, params] as const,
  assetDeviceCurrent: (id: string, version?: number) =>
    ["receiving", "asset-devices", "current", id, version] as const,
  assetDeviceCurrentItems: (id: string, params?: Record<string, unknown>) =>
    ["receiving", "asset-devices", "current-items", id, params] as const,
  assetDeviceDiff: (id: string, params?: Record<string, unknown>) =>
    ["receiving", "asset-devices", "diff", id, params] as const,

  assetComponentsAll: ["receiving", "asset-components"] as const,
  assetComponents: (params?: Record<string, unknown>) => ["receiving", "asset-components", "list", params] as const,
  assetComponent: (id: string) => ["receiving", "asset-components", "detail", id] as const,
  assetComponentHistory: (id: string, page?: number) => ["receiving", "asset-components", "history", id, page] as const,
}
