import { api } from "./api"
import type { Envelope } from "./types"

export interface SpecSchemaFieldDTO {
  name: string
  type: "integer" | "number" | "string" | "boolean"
  required: boolean
  nullable: boolean
  enum?: string[]
  unit?: string
  minimum?: number
  maximum?: number
  max_length?: number
}

export interface SpecSchemaDTO {
  schema_version: number
  fields: SpecSchemaFieldDTO[]
}

export interface ReceivingMetadataDTO {
  component_kinds: string[]
  device_categories: string[]
  spec_schemas: Record<string, SpecSchemaDTO>
  limits: Record<string, number>
  capabilities: Record<string, boolean>
  accepted_image_types: string[]
  states: Record<string, string[]>
}

export interface AssetSpec {
  schema_version: number
  capacity_bytes?: number | null
  memory_generation?: string | null
  speed_mt_s?: number | null
  ecc?: boolean | null
  interface?: string | null
  media_type?: string | null
  form_factor?: string | null
  socket?: string | null
  cores?: number | null
  threads?: number | null
  base_frequency_mhz?: number | null
  protocol?: string | null
  port_count?: number | null
  speed_mbps?: number | null
  rated_power_w?: number | null
  input_type?: string | null
  cache_bytes?: number | null
  has_nonvolatile_cache?: boolean | null
  connector?: string | null
  wavelength_nm?: number | null
  width_mm?: number | null
  depth_mm?: number | null
  weight_kg?: number | null
  description?: string | null
  [key: string]: unknown
}

export interface AssetPosition {
  schema_version: number
  side?: string | null
  row?: number | null
  column?: number | null
}

export interface AssetLocation {
  warehouse_id: string
  bin_id: string | null
  warehouse_name?: string
  bin_name?: string
  path?: string
}

export interface AssetLocationInput {
  warehouse_id: string
  bin_id: string | null
}

export interface AssetSnapshotDTO {
  schema_version: number
  name: string
  manufacturer_name: string
  model_revision_id: string
  serial_number: string | null
  spec: AssetSpec
  location?: AssetLocation | null
}

export interface AssetActionDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  kind: string
  resource_id: string
  receipt_id?: string | null
  actor_user_id: string
  request_id: string
  before: unknown
  after: unknown
}

export interface ReferenceCountDTO {
  resource: string
  count: number
}

export function createIdempotencyKey(prefix = "web"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function idempotencyHeaders(key?: string) {
  return key ? { "Idempotency-Key": key } : undefined
}

export function toLocationInput(loc?: AssetLocation | AssetLocationInput | null): AssetLocationInput | null {
  if (!loc || !loc.warehouse_id) return null
  return {
    warehouse_id: loc.warehouse_id,
    bin_id: loc.bin_id ?? null,
  }
}

export function normalizeSpecPayload(
  raw: Record<string, unknown> | undefined,
  schema?: SpecSchemaDTO,
): AssetSpec {
  const out: AssetSpec = { schema_version: schema?.schema_version ?? 1 }
  if (!schema) return out
  for (const field of schema.fields) {
    if (field.name === "schema_version") continue
    const val = raw?.[field.name]
    if (val === undefined || val === null || val === "") {
      if (field.required) {
        out[field.name] = null
      }
      continue
    }
    if (field.type === "integer" || field.type === "number") {
      const n = typeof val === "number" ? val : Number(val)
      if (Number.isFinite(n)) {
        out[field.name] = field.type === "integer" ? Math.trunc(n) : n
      }
    } else if (field.type === "boolean") {
      out[field.name] = Boolean(val)
    } else {
      out[field.name] = String(val).trim()
    }
  }
  return out
}

export const receivingMetadataService = {
  get: (signal?: AbortSignal) =>
    api.get("/asset-management/metadata", { signal }) as Promise<Envelope<ReceivingMetadataDTO>>,
}
