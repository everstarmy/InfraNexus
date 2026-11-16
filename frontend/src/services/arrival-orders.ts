import { api } from "./api"
import { idempotencyHeaders, type AssetActionDTO } from "./receiving-metadata"
import type { Envelope, PageData } from "./types"

export type ArrivalOrderState = "draft" | "open" | "completed" | "closed" | "canceled"
export type ArrivalOrderAllowedAction = "update" | "open" | "close" | "cancel" | "receive"

export interface ArrivalOrderDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  number: string
  name: string
  supplier_id: string
  external_order_no: string | null
  expected_arrival_date: string | null
  description: string
  state: ArrivalOrderState
  created_by: string
  opened_at: string | null
  completed_at: string | null
  closed_at: string | null
  close_reason: string | null
  planned_quantity: number
  accepted_quantity: number
  remaining_quantity: number
  allowed_actions: ArrivalOrderAllowedAction[]
}

export interface ArrivalComponentDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  purchase_line_id: string
  part_model_revision_id: string
  slot_key: string | null
  quantity: number
  required: boolean
}

export interface ArrivalLineDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  purchase_batch_id: string
  line_no: number
  device_model_revision_id: string
  planned_quantity: number
  accepted_quantity: number
  remaining_quantity: number
  note: string
  expected_components: ArrivalComponentDTO[]
}

export interface ArrivalOrderInput {
  name: string
  supplier_id: string
  external_order_no: string | null
  expected_arrival_date: string | null
  description: string
}

export interface ArrivalLineCreateInput {
  expected_version: number
  device_model_revision_id: string
  planned_quantity: number
  configuration_source: "model"
  note: string
}

export interface ArrivalComponentEditInput {
  id?: string
  part_model_revision_id: string
  slot_key: string | null
  quantity: number
  required: boolean
}

export interface ArrivalLineUpdateInput {
  planned_quantity: number
  note: string
  expected_components: ArrivalComponentEditInput[]
}

export interface ArrivalOrderListParams {
  page?: number
  page_size?: number
  search?: string
  state?: ArrivalOrderState
  supplier_id?: string
  created_from?: string
  created_to?: string
}

export const arrivalOrdersService = {
  list: (params?: ArrivalOrderListParams, signal?: AbortSignal) =>
    api.get("/arrival-orders", { params, signal }) as Promise<Envelope<PageData<ArrivalOrderDTO>>>,
  get: (id: string, signal?: AbortSignal) =>
    api.get(`/arrival-orders/${id}`, { signal }) as Promise<Envelope<ArrivalOrderDTO>>,
  create: (data: ArrivalOrderInput, idempotencyKey: string) =>
    api.post("/arrival-orders", data, { headers: idempotencyHeaders(idempotencyKey) }) as Promise<Envelope<ArrivalOrderDTO>>,
  update: (id: string, expectedVersion: number, data: ArrivalOrderInput) =>
    api.put(`/arrival-orders/${id}`, { expected_version: expectedVersion, data }) as Promise<Envelope<ArrivalOrderDTO>>,
  history: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/arrival-orders/${id}/history`, { params, signal }) as Promise<Envelope<PageData<AssetActionDTO>>>,
  listLines: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/arrival-orders/${id}/lines`, { params, signal }) as Promise<Envelope<PageData<ArrivalLineDTO>>>,
  createLine: (id: string, data: ArrivalLineCreateInput, idempotencyKey: string) =>
    api.post(`/arrival-orders/${id}/lines`, data, {
      headers: idempotencyHeaders(idempotencyKey),
    }) as Promise<Envelope<{ line: ArrivalLineDTO; order_version: number }>>,
  updateLine: (id: string, lineId: string, expectedVersion: number, data: ArrivalLineUpdateInput) =>
    api.put(`/arrival-orders/${id}/lines/${lineId}`, {
      expected_version: expectedVersion,
      data,
    }) as Promise<Envelope<{ order_version: number }>>,
  deleteLine: (id: string, lineId: string, expectedVersion: number) =>
    api.delete(`/arrival-orders/${id}/lines/${lineId}`, {
      params: { expected_version: expectedVersion },
    }) as Promise<Envelope<{ order_version: number }>>,
  open: (id: string, expectedVersion: number, idempotencyKey: string) =>
    api.post(
      `/arrival-orders/${id}/open`,
      { expected_version: expectedVersion },
      { headers: idempotencyHeaders(idempotencyKey) },
    ) as Promise<Envelope<ArrivalOrderDTO>>,
  close: (id: string, expectedVersion: number, reason: string, idempotencyKey: string) =>
    api.post(
      `/arrival-orders/${id}/close`,
      { expected_version: expectedVersion, reason },
      { headers: idempotencyHeaders(idempotencyKey) },
    ) as Promise<Envelope<ArrivalOrderDTO>>,
  cancel: (id: string, expectedVersion: number, reason: string, idempotencyKey: string) =>
    api.post(
      `/arrival-orders/${id}/cancel`,
      { expected_version: expectedVersion, reason },
      { headers: idempotencyHeaders(idempotencyKey) },
    ) as Promise<Envelope<ArrivalOrderDTO>>,
}
