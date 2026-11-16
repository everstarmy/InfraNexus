import type { ReceiptIssueDTO } from "@/lib/api-error"
import { api } from "./api"
import {
  idempotencyHeaders,
  type AssetActionDTO,
  type AssetLocation,
  type AssetLocationInput,
} from "./receiving-metadata"
import type { Envelope, PageData } from "./types"

export type ReceiptState = "draft" | "completed" | "canceled"
export type InspectionResult = "pending" | "pass" | "reject"
export type PlacementKind = "installed" | "stored"
export type ReceiptAllowedAction = "update" | "evidence" | "preview" | "complete" | "cancel"

export interface ReceiptResultDTO {
  receipt_id: string
  state: string
  version: number
  completed_at: string
  action_id: string
  accepted_device_count: number
  rejected_device_count: number
  created_part_count: number
  purchase_batch_id: string
  order_version: number
  result_items_url: string
}

export interface ReceiptDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  number: string
  purchase_batch_id: string
  state: ReceiptState
  note: string
  created_by: string
  completed_by: string | null
  completed_at: string | null
  canceled_at: string | null
  cancel_reason: string | null
  result: ReceiptResultDTO
  device_count: number
  component_count: number
  passed_count: number
  rejected_count: number
  allowed_actions: ReceiptAllowedAction[]
}

export interface ReceiptItemDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  sn_rule_version: number
  receipt_id: string
  purchase_line_id: string
  device_model_revision_id: string
  serial_number: string | null
  custody_location_id: string | null
  inspection_result: InspectionResult
  inspected_at: string | null
  difference_reason: string | null
  reject_reason: string | null
  configuration_confirmed: boolean
  receipt_version: number
  location: AssetLocation | null
}

export interface ReceiptComponentDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  sn_rule_version: number
  receipt_item_id: string
  part_model_revision_id: string
  serial_number: string | null
  initial_placement: PlacementKind
  slot_key: string | null
  custody_location_id: string | null
}

export interface AssetAttachmentDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  receipt_item_id: string
  original_filename: string
  detected_mime: string
  size_bytes: number
  sha256: string
  uploaded_by: string
  baseline_id: string | null
}

export interface ReceiptPreviewDTO {
  receipt_id: string
  checked_version: number
  can_complete: boolean
  errors: ReceiptIssueDTO[]
  warnings: ReceiptIssueDTO[]
  summary: ReceiptResultDTO
}

export interface ReceiptResultItemDTO {
  receipt_item_id: string
  inspection_result: InspectionResult
  device_id: string | null
  baseline_id: string | null
  part_count: number
}

export interface ReceiptListParams {
  page?: number
  page_size?: number
  search?: string
  purchase_batch_id?: string
  state?: ReceiptState
  created_from?: string
  created_to?: string
}

export interface ReceiptItemCreateInput {
  expected_version: number
  purchase_line_id: string
  serial_number: string | null
  configuration_source: "order"
}

export interface ReceiptItemUpdateInput {
  serial_number: string | null
  location: AssetLocationInput | null
  inspection_result: InspectionResult
  inspected_at: string | null
  difference_reason: string | null
  reject_reason: string | null
  configuration_confirmed: boolean
}

export interface ReceiptComponentCreateInput {
  expected_version: number
  part_model_revision_id: string
  quantity: number
  initial_placement: PlacementKind
  location: AssetLocationInput | null
  units?: Array<{ serial_number: string | null; slot_key: string | null }>
}

export interface ReceiptComponentUpdateInput {
  serial_number: string | null
  slot_key: string | null
  initial_placement: PlacementKind
  location: AssetLocationInput | null
}

export function attachmentContentUrl(attachmentId: string): string {
  return `/api/v1/asset-attachments/${attachmentId}/content`
}

export const receiptsService = {
  list: (params?: ReceiptListParams, signal?: AbortSignal) =>
    api.get("/receipts", { params, signal }) as Promise<Envelope<PageData<ReceiptDTO>>>,
  get: (id: string, signal?: AbortSignal) =>
    api.get(`/receipts/${id}`, { signal }) as Promise<Envelope<ReceiptDTO>>,
  create: (purchaseBatchId: string, note: string, idempotencyKey: string) =>
    api.post(
      "/receipts",
      { purchase_batch_id: purchaseBatchId, note },
      { headers: idempotencyHeaders(idempotencyKey) },
    ) as Promise<Envelope<ReceiptDTO>>,
  update: (id: string, expectedVersion: number, note: string) =>
    api.put(`/receipts/${id}`, {
      expected_version: expectedVersion,
      data: { note },
    }) as Promise<Envelope<ReceiptDTO>>,
  history: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/receipts/${id}/history`, { params, signal }) as Promise<Envelope<PageData<AssetActionDTO>>>,
  listItems: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/receipts/${id}/items`, { params, signal }) as Promise<Envelope<PageData<ReceiptItemDTO>>>,
  getItem: (id: string, itemId: string, signal?: AbortSignal) =>
    api.get(`/receipts/${id}/items/${itemId}`, { signal }) as Promise<Envelope<ReceiptItemDTO>>,
  createItem: (id: string, data: ReceiptItemCreateInput, idempotencyKey: string) =>
    api.post(`/receipts/${id}/items`, data, {
      headers: idempotencyHeaders(idempotencyKey),
    }) as Promise<Envelope<{ item: ReceiptItemDTO; receipt_version: number }>>,
  updateItem: (id: string, itemId: string, expectedVersion: number, data: ReceiptItemUpdateInput) =>
    api.put(`/receipts/${id}/items/${itemId}`, {
      expected_version: expectedVersion,
      data,
    }) as Promise<Envelope<{ item: ReceiptItemDTO; receipt_version: number }>>,
  deleteItem: (id: string, itemId: string, expectedVersion: number) =>
    api.delete(`/receipts/${id}/items/${itemId}`, {
      params: { expected_version: expectedVersion },
    }) as Promise<Envelope<{ receipt_version: number }>>,
  listComponents: (
    id: string,
    itemId: string,
    params?: {
      page?: number
      page_size?: number
      kind?: string
      serial_status?: "present" | "missing"
      placement_kind?: PlacementKind
    },
    signal?: AbortSignal,
  ) =>
    api.get(`/receipts/${id}/items/${itemId}/components`, {
      params,
      signal,
    }) as Promise<Envelope<PageData<ReceiptComponentDTO>>>,
  createComponents: (id: string, itemId: string, data: ReceiptComponentCreateInput, idempotencyKey: string) =>
    api.post(`/receipts/${id}/items/${itemId}/components`, data, {
      headers: idempotencyHeaders(idempotencyKey),
    }) as Promise<Envelope<{ items: ReceiptComponentDTO[]; receipt_version: number }>>,
  updateComponent: (
    id: string,
    itemId: string,
    componentId: string,
    expectedVersion: number,
    data: ReceiptComponentUpdateInput,
  ) =>
    api.patch(`/receipts/${id}/items/${itemId}/components/${componentId}`, {
      expected_version: expectedVersion,
      data,
    }) as Promise<Envelope<{ item: ReceiptComponentDTO; receipt_version: number }>>,
  deleteComponent: (id: string, itemId: string, componentId: string, expectedVersion: number) =>
    api.delete(`/receipts/${id}/items/${itemId}/components/${componentId}`, {
      params: { expected_version: expectedVersion },
    }) as Promise<Envelope<{ receipt_version: number }>>,
  listPhotos: (id: string, itemId: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/receipts/${id}/items/${itemId}/photos`, {
      params,
      signal,
    }) as Promise<Envelope<PageData<AssetAttachmentDTO>>>,
  uploadPhoto: (
    id: string,
    itemId: string,
    expectedVersion: number,
    file: File,
    idempotencyKey: string,
    onProgress?: (percent: number) => void,
  ) => {
    const form = new FormData()
    form.append("expected_version", String(expectedVersion))
    form.append("file", file)
    return api.post(`/receipts/${id}/items/${itemId}/photos`, form, {
      headers: {
        "Content-Type": undefined,
        "Idempotency-Key": idempotencyKey,
      },
      onUploadProgress: (evt) => {
        if (onProgress && evt.total) {
          onProgress(Math.round((evt.loaded * 100) / evt.total))
        }
      },
    }) as Promise<Envelope<{ item: AssetAttachmentDTO; receipt_version: number }>>
  },
  deletePhoto: (id: string, itemId: string, photoId: string, expectedVersion: number) =>
    api.delete(`/receipts/${id}/items/${itemId}/photos/${photoId}`, {
      params: { expected_version: expectedVersion },
    }) as Promise<Envelope<{ receipt_version: number }>>,
  preview: (id: string) =>
    api.post(`/receipts/${id}/preview`, {}) as Promise<Envelope<ReceiptPreviewDTO>>,
  complete: (id: string, expectedVersion: number, idempotencyKey: string) =>
    api.post(
      `/receipts/${id}/complete`,
      { expected_version: expectedVersion },
      { headers: idempotencyHeaders(idempotencyKey) },
    ) as Promise<Envelope<ReceiptResultDTO>>,
  cancel: (id: string, expectedVersion: number, reason: string, idempotencyKey: string) =>
    api.post(
      `/receipts/${id}/cancel`,
      { expected_version: expectedVersion, reason },
      { headers: idempotencyHeaders(idempotencyKey) },
    ) as Promise<Envelope<ReceiptDTO>>,
  result: (id: string, signal?: AbortSignal) =>
    api.get(`/receipts/${id}/result`, { signal }) as Promise<Envelope<ReceiptResultDTO>>,
  resultItems: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/receipts/${id}/result/items`, { params, signal }) as Promise<Envelope<PageData<ReceiptResultItemDTO>>>,
}
