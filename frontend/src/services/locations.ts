import { api } from "./api"
import { createManagedClient, type ManagedBase } from "./managed"
import type { Envelope } from "./types"

export type DatacenterKind = "primary" | "metro_dr" | "remote_dr"

export interface DatacenterDTO extends ManagedBase {
  kind: DatacenterKind
  address?: string
  owner_id?: string | null
}

export interface BuildingDTO extends ManagedBase {
  datacenter_id: string
}

export interface FloorDTO extends ManagedBase {
  building_id: string
  level: number
}

export interface RoomDTO extends ManagedBase {
  floor_id: string
  datacenter_id?: string
}

export interface RackRowDTO extends ManagedBase {
  room_id: string
}

export interface RackDTO extends ManagedBase {
  rack_row_id: string
  room_id?: string
  security_zone_id?: string | null
  units: number
  max_load_kg: number
  label?: string
}

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

export const datacentersService = createManagedClient<DatacenterDTO>(
  "/locations/datacenters"
)
export const buildingsService = createManagedClient<BuildingDTO>(
  "/locations/buildings"
)
export const floorsService = createManagedClient<FloorDTO>(
  "/locations/floors"
)
export const roomsService = createManagedClient<RoomDTO>(
  "/locations/rooms"
)
export const rackRowsService = createManagedClient<RackRowDTO>(
  "/locations/rack-rows"
)

const baseRacksClient = createManagedClient<RackDTO>("/locations/racks")
export const racksService = {
  ...baseRacksClient,
  units: (rackId: string, signal?: AbortSignal) =>
    api.get(`/locations/racks/${rackId}/units`, { signal }) as Promise<
      Envelope<RackUnitView>
    >,
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
