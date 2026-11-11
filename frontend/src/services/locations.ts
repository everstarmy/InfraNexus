import { api } from "./api"
import { createManagedClient, type ManagedBase, type ManagedAudit, type ManagedQueryParams, type ManagedReferenceCount } from "./managed"
import type { Envelope, PageData } from "./types"

export interface RackUnit {
  available: boolean
  unit: number
  state: string
  subject_id?: string | null
}

export interface RackUnitView {
  rack_id: string
  units: RackUnit[]
}

export interface WarehouseDTO extends ManagedBase {
  datacenter_id: string
  contact_person?: string
}

export interface ShelfDTO extends ManagedBase {
  warehouse_id: string
  layer_count: number
  capacity: number
}

export interface BinDTO extends ManagedBase {
  shelf_id: string
  layer: number
  capacity: number
}

export interface TemporaryLocationDTO extends ManagedBase {
  datacenter_id: string
  owner_id: string
}

export type LocationType = "datacenter" | "building" | "room" | "rack"

export interface DatacenterContact {
  name: string
  phone?: string
  email?: string
}

export interface DatacenterExt extends Record<string, unknown> {
  address: string
  contact: DatacenterContact
}

export interface BuildingExt extends Record<string, unknown> {}

export interface RoomExt extends Record<string, unknown> {
  floor: number
}

export interface RackExt extends Record<string, unknown> {
  row: string
  column: number
  height_u: number
  power_capacity_w?: number | null
}

export interface LocationNode<TExt = Record<string, any>> {
  path?: { uid: string; name: string; type: LocationType }[]
  has_children?: boolean
  security_zone_id?: string | null
  uid: string
  name: string
  type: LocationType
  parent: string | null
  ext: TExt
  status: number
  version: number
  created_at?: string
  updated_at?: string
}

const nodes = "/locations/nodes"
export const locationsService = {
  list: (
    params: {
      parent?: string
      type?: LocationType
      page?: number
      page_size?: number
      search?: string
      floor?: number | string
      row?: string
      column?: number | string
      status?: number
    },
    signal?: AbortSignal,
    searchAll = false
  ) =>
    api.get(searchAll ? `${nodes}/search` : nodes, { params, signal }) as Promise<Envelope<PageData<LocationNode>>>,
  get: (uid: string, signal?: AbortSignal) =>
    api.get(`${nodes}/${uid}`, { signal }) as Promise<Envelope<LocationNode>>,
  create: (data: { name: string; type: LocationType; parent: string | null; ext: Record<string, unknown> }, idempotencyKey?: string) =>
    api.post(nodes, data, { headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }) as Promise<Envelope<LocationNode>>,
  update: (uid: string, data: { name: string; ext: Record<string, unknown>; version: number }) =>
    api.put(`${nodes}/${uid}`, data) as Promise<Envelope<LocationNode>>,
  status: (uid: string, version: number, status: number) =>
    api.patch(`${nodes}/${uid}/status`, { version, status }) as Promise<Envelope<LocationNode>>,
  remove: (uid: string, version: number) =>
    api.delete(`${nodes}/${uid}`, { params: { version } }) as Promise<Envelope<void>>,
  history: (uid: string, params?: ManagedQueryParams, signal?: AbortSignal) =>
    api.get(`${nodes}/${uid}/history`, { params, signal }) as Promise<Envelope<PageData<ManagedAudit>>>,
  references: (uid: string, signal?: AbortSignal) =>
    api.get(`${nodes}/${uid}/references`, { signal }) as Promise<Envelope<ManagedReferenceCount[]>>,
  securityZone: (uid: string, version: number, security_zone_id: string | null) =>
    api.put(`${nodes}/${uid}/security-zone`, { version, security_zone_id }) as Promise<Envelope<LocationNode>>,
  units: (uid: string, signal?: AbortSignal) =>
    api.get(`${nodes}/${uid}/units`, { signal }) as Promise<Envelope<RackUnitView>>,
}

export const datacentersService = {
  list: async (params: { page?: number; page_size?: number; search?: string }, signal?: AbortSignal) => {
    const result = await locationsService.list({ ...params, type: "datacenter" }, signal)
    return { ...result, data: { ...result.data, items: result.data.items.map(({ uid, name, status }) => ({ id: uid, name, status })) } }
  },
}

export const warehousesService = createManagedClient<WarehouseDTO>(
  "/locations/warehouses"
)
export const shelvesService = createManagedClient<ShelfDTO>(
  "/locations/shelves"
)
export const binsService = createManagedClient<BinDTO>(
  "/locations/bins"
)
export const temporaryLocationsService = createManagedClient<TemporaryLocationDTO>(
  "/locations/temporary-locations"
)
