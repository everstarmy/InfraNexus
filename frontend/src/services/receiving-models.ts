import { api } from "./api"
import {
  idempotencyHeaders,
  type AssetActionDTO,
  type AssetPosition,
  type AssetSpec,
} from "./receiving-metadata"
import type { Envelope, PageData } from "./types"

export type ModelRevisionState = "draft" | "published"
export type MountingType = "rack" | "blade" | "standalone"
export type PortSourceKind = "fixed" | "option_slot"
export type CompatibilityStatus = "pending" | "confirmed" | "incompatible"

export interface ModelSlotDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  device_model_revision_id: string
  stable_key: string
  name: string
  kind: string
  interface: string | null
  form_factor: string | null
  position: AssetPosition
}

export interface ModelPortDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  device_model_revision_id: string
  stable_key: string
  name: string
  protocol: string
  connector: string
  speed_mbps: number | null
  source_kind: PortSourceKind
  slot_key: string | null
}

export interface ModelStandardComponentDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  device_model_revision_id: string
  part_model_revision_id: string
  slot_key: string | null
  quantity: number
  required: boolean
}

export interface ModelCompatibilityDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  device_model_revision_id: string
  part_model_revision_id: string
  slot_key: string | null
  status: CompatibilityStatus
  evidence_note: string
  confirmed_by?: string | null
  confirmed_at?: string | null
}

export interface CatalogRevisionDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  model_id: string
  name?: string
  description?: string
  status?: number
  revision_no: number
  state: ModelRevisionState
  tracking_mode?: string
  unit?: string
  mounting_type?: MountingType | ""
  height_u: number | null
  rated_power_w: number | null
  spec: AssetSpec
  published_at: string | null
  published_by: string | null
  slots?: ModelSlotDTO[]
  ports?: ModelPortDTO[]
  standard_components?: ModelStandardComponentDTO[]
  compatibilities?: ModelCompatibilityDTO[]
}

export interface CompatibleComponentOptionDTO {
  part_model_id: string
  part_model_revision_id: string
  manufacturer_id: string
  name: string
  part_no: string
  kind: string
  revision_no: number
  spec: AssetSpec
  slot_keys: string[]
  allows_unassigned: boolean
}

export interface CompatibleComponentListParams {
  page?: number
  page_size?: number
  slot_key?: string
  kind?: string
  search?: string
}

export interface DeviceRevisionListParams {
  page?: number
  page_size?: number
  state?: ModelRevisionState
  status?: number
  selectable?: boolean
}

export interface CatalogModelDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  manufacturer_id: string
  name: string
  part_no?: string
  model_name?: string
  kind?: string
  category?: string
  status: number
  description: string
  latest_published_revision?: CatalogRevisionDTO | null
}

export interface ComponentModelCreateInput {
  manufacturer_id: string
  name: string
  part_no: string
  kind: string
  description: string
}

export interface DeviceModelCreateInput {
  manufacturer_id: string
  name: string
  model_name: string
  category: string
  description: string
}

export interface CatalogModelUpdateInput {
  name: string
  description: string
}

export interface ModelSlotInput {
  id?: string
  stable_key: string
  name: string
  kind: string
  interface: string | null
  form_factor: string | null
  position: AssetPosition
}

export interface ModelPortInput {
  id?: string
  stable_key: string
  name: string
  protocol: string
  connector: string
  speed_mbps: number | null
  source_kind: PortSourceKind
  slot_key: string | null
}

export interface ModelStandardComponentInput {
  id?: string
  part_model_revision_id: string
  slot_key: string | null
  quantity: number
  required: boolean
}

export interface ModelCompatibilityInput {
  id?: string
  part_model_revision_id: string
  slot_key: string | null
  status: CompatibilityStatus
  evidence_note: string
}

export interface ComponentRevisionUpdateInput {
  tracking_mode: "individual"
  unit: "piece"
  spec: AssetSpec
}

export interface DeviceRevisionUpdateInput {
  name: string
  description: string
  mounting_type: MountingType
  height_u: number | null
  rated_power_w: number | null
  spec: AssetSpec
  slots: ModelSlotInput[]
  ports: ModelPortInput[]
  standard_components: ModelStandardComponentInput[]
  compatibilities: ModelCompatibilityInput[]
}

export interface ModelListParams {
  page?: number
  page_size?: number
  search?: string
  manufacturer_id?: string
  kind?: string
  category?: string
  status?: number
  created_from?: string
  created_to?: string
}

function createCatalogClient<TCreate, TRevUpdate>(basePath: string) {
  return {
    list: (params?: ModelListParams, signal?: AbortSignal) =>
      api.get(basePath, { params, signal }) as Promise<Envelope<PageData<CatalogModelDTO>>>,
    get: (id: string, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}`, { signal }) as Promise<Envelope<CatalogModelDTO>>,
    create: (data: TCreate, idempotencyKey: string) =>
      api.post(basePath, data, { headers: idempotencyHeaders(idempotencyKey) }) as Promise<Envelope<CatalogModelDTO>>,
    update: (id: string, expectedVersion: number, data: CatalogModelUpdateInput) =>
      api.put(`${basePath}/${id}`, { expected_version: expectedVersion, data }) as Promise<Envelope<CatalogModelDTO>>,
    setStatus: (id: string, expectedVersion: number, status: number) =>
      api.patch(`${basePath}/${id}/status`, { expected_version: expectedVersion, status }) as Promise<Envelope<CatalogModelDTO>>,
    remove: (id: string, expectedVersion: number) =>
      api.delete(`${basePath}/${id}`, { params: { expected_version: expectedVersion } }) as Promise<Envelope<{ deleted: boolean }>>,
    history: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}/history`, { params, signal }) as Promise<Envelope<PageData<AssetActionDTO>>>,
    references: (id: string, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}/references`, { signal }) as Promise<Envelope<{ revisions: number }>>,
    listRevisions: (id: string, params?: { page?: number; page_size?: number; state?: ModelRevisionState }, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}/revisions`, { params, signal }) as Promise<Envelope<PageData<CatalogRevisionDTO>>>,
    getRevision: (id: string, revId: string, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}/revisions/${revId}`, { signal }) as Promise<Envelope<CatalogRevisionDTO>>,
    createRevision: (id: string, fromRevisionId: string | null, idempotencyKey: string) =>
      api.post(
        `${basePath}/${id}/revisions`,
        { from_revision_id: fromRevisionId },
        { headers: idempotencyHeaders(idempotencyKey) },
      ) as Promise<Envelope<CatalogRevisionDTO>>,
    updateRevision: (id: string, revId: string, expectedVersion: number, data: TRevUpdate) =>
      api.put(`${basePath}/${id}/revisions/${revId}`, {
        expected_version: expectedVersion,
        data,
      }) as Promise<Envelope<CatalogRevisionDTO>>,
    deleteRevision: (id: string, revId: string, expectedVersion: number) =>
      api.delete(`${basePath}/${id}/revisions/${revId}`, {
        params: { expected_version: expectedVersion },
      }) as Promise<Envelope<{ deleted: boolean }>>,
    publishRevision: (id: string, revId: string, expectedVersion: number, idempotencyKey: string) =>
      api.post(
        `${basePath}/${id}/revisions/${revId}/publish`,
        { expected_version: expectedVersion },
        { headers: idempotencyHeaders(idempotencyKey) },
      ) as Promise<Envelope<CatalogRevisionDTO>>,
  }
}

export const componentModelsService = createCatalogClient<ComponentModelCreateInput, ComponentRevisionUpdateInput>(
  "/model-management/component-models",
)

const baseDeviceModelsClient = createCatalogClient<DeviceModelCreateInput, DeviceRevisionUpdateInput>(
  "/model-management/device-models",
)

export const deviceModelsService = {
  ...baseDeviceModelsClient,
  listRevisions: (id: string, params?: DeviceRevisionListParams, signal?: AbortSignal) =>
    api.get(`/model-management/device-models/${id}/revisions`, { params, signal }) as Promise<
      Envelope<PageData<CatalogRevisionDTO>>
    >,
  setRevisionStatus: (id: string, revId: string, expectedVersion: number, status: number) =>
    api.patch(`/model-management/device-models/${id}/revisions/${revId}/status`, {
      expected_version: expectedVersion,
      status,
    }) as Promise<Envelope<CatalogRevisionDTO>>,
  listCompatibleComponents: (
    id: string,
    revId: string,
    params?: CompatibleComponentListParams,
    signal?: AbortSignal,
  ) =>
    api.get(`/model-management/device-models/${id}/revisions/${revId}/compatible-components`, {
      params,
      signal,
    }) as Promise<Envelope<PageData<CompatibleComponentOptionDTO>>>,
}

export function formatRevisionTitle(rev: { name?: string | null; revision_no: number }): string {
  const name = rev.name?.trim()
  return name ? `${name} · v${rev.revision_no}` : `v${rev.revision_no}`
}

export function formatCompatibleComponentLabel(opt: CompatibleComponentOptionDTO): string {
  return `${opt.name} (${opt.part_no || opt.kind}) · v${opt.revision_no}`
}

export interface PublishedRevisionOption {
  model: CatalogModelDTO
  revision: CatalogRevisionDTO
  label: string
}

async function listPublishedRevisionOptions(
  client: ReturnType<typeof createCatalogClient<never, never>>,
  signal?: AbortSignal,
): Promise<PublishedRevisionOption[]> {
  const modelsRes = await client.list({ page: 1, page_size: 100 }, signal)
  const withRev = modelsRes.data.items.filter((m) => Boolean(m.latest_published_revision))
  const revLists = await Promise.all(
    withRev.map(async (model) => {
      const revsRes = await client.listRevisions(model.id, { state: "published", page: 1, page_size: 100 }, signal)
      return revsRes.data.items.map((revision) => ({
        model,
        revision,
        label: `${model.name} (${model.part_no || model.model_name || model.kind || model.category || ""}) · ${formatRevisionTitle(revision)}`,
      }))
    }),
  )
  return revLists.flat()
}

export const listPublishedComponentRevisions = (signal?: AbortSignal) =>
  listPublishedRevisionOptions(
    componentModelsService as unknown as ReturnType<typeof createCatalogClient<never, never>>,
    signal,
  )

export const listPublishedDeviceRevisions = (signal?: AbortSignal) =>
  listPublishedRevisionOptions(
    deviceModelsService as unknown as ReturnType<typeof createCatalogClient<never, never>>,
    signal,
  )

export async function listSelectableDeviceRevisions(
  modelId: string,
  signal?: AbortSignal,
): Promise<CatalogRevisionDTO[]> {
  const res = await deviceModelsService.listRevisions(
    modelId,
    { selectable: true, page: 1, page_size: 100 },
    signal,
  )
  return res.data.items
}
