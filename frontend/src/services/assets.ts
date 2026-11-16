import { api } from "./api"
import {
  idempotencyHeaders,
  type AssetActionDTO,
  type AssetLocation,
  type AssetSnapshotDTO,
} from "./receiving-metadata"
import type { AssetAttachmentDTO, PlacementKind } from "./receipts"
import type { Envelope, PageData } from "./types"

export interface AssetDeviceDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  sn_rule_version: number
  asset_code: string
  device_model_revision_id: string
  manufacturer_id: string
  serial_number: string
  supplier_id: string
  source_receipt_item_id: string
  lifecycle_state: string
  current_custody_location_id: string
  configuration_version: number
  location?: AssetLocation | null
  baseline_id?: string
}

export interface OriginalConfigurationDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  device_id: string
  receipt_item_id: string
  device_model_revision_id: string
  snapshot: AssetSnapshotDTO
  accepted_at: string
  accepted_by: string
  action_id: string
  component_count: number
  photos: AssetAttachmentDTO[]
}

export interface AssetPartDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  sn_rule_version: number
  internal_code: string
  part_model_revision_id: string
  manufacturer_id: string
  serial_number: string | null
  source_receipt_component_id: string
  quality_state: string
}

export interface OriginalConfigurationItemDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  baseline_id: string
  part_item_id: string
  part_model_revision_id: string
  snapshot: AssetSnapshotDTO
  serial_number_at_receipt: string | null
  original_slot_key: string | null
  original_placement: PlacementKind
  current_identity?: AssetPartDTO | null
}

export interface CurrentConfigurationSummaryDTO {
  configuration_version: number
  component_count: number
  unknown_slot_count: number
  confirmed_at: string
}

export interface PartAllocationDTO {
  id: string
  version: number
  created_at: string
  updated_at: string
  part_item_id: string
  device_id: string
  slot_key: string | null
  installed_at: string | null
  recorded_at: string
  removed_at: string | null
  ended_recorded_at: string | null
  start_action_id: string
  end_action_id: string | null
}

export interface CurrentConfigurationItemDTO extends PartAllocationDTO {
  part: AssetPartDTO
}

export type ConfigurationDiffKind = "added" | "removed" | "moved" | "unchanged"

export interface ConfigurationDiffItemDTO {
  part_item_id: string
  change: ConfigurationDiffKind
  original_slot_key: string | null
  current_slot_key: string | null
}

export interface ConfigurationDiffResponseDTO extends PageData<ConfigurationDiffItemDTO> {
  baseline_id: string
  configuration_version: number
}

export interface AssetPartDetailDTO extends AssetPartDTO {
  placement: {
    id: string
    part_item_id: string
    kind: PlacementKind
    allocation_id: string | null
    custody_location_id: string | null
    last_action_id: string
  }
  source_device_id: string
  current_device_id: string | null
  slot_key: string | null
  location: AssetLocation | null
  identity_event_id?: string
}

export interface AssetDeviceListParams {
  page?: number
  page_size?: number
  search?: string
  device_model_id?: string
  manufacturer_id?: string
  supplier_id?: string
  warehouse_id?: string
  lifecycle_state?: string
  source_receipt_id?: string
  created_from?: string
  created_to?: string
}

export interface AssetComponentListParams {
  page?: number
  page_size?: number
  search?: string
  part_model_id?: string
  source_device_id?: string
  current_device_id?: string
  warehouse_id?: string
  placement_kind?: PlacementKind
  serial_status?: "present" | "missing"
  created_from?: string
  created_to?: string
}

export const assetsService = {
  listDevices: (params?: AssetDeviceListParams, signal?: AbortSignal) =>
    api.get("/assets/devices", { params, signal }) as Promise<Envelope<PageData<AssetDeviceDTO>>>,
  getDevice: (id: string, signal?: AbortSignal) =>
    api.get(`/assets/devices/${id}`, { signal }) as Promise<Envelope<AssetDeviceDTO>>,
  getDeviceHistory: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/assets/devices/${id}/history`, { params, signal }) as Promise<Envelope<PageData<AssetActionDTO>>>,
  getOriginalConfiguration: (id: string, signal?: AbortSignal) =>
    api.get(`/assets/devices/${id}/original-configuration`, { signal }) as Promise<Envelope<OriginalConfigurationDTO>>,
  listOriginalConfigurationItems: (
    id: string,
    params?: { page?: number; page_size?: number; include_current_identity?: boolean },
    signal?: AbortSignal,
  ) =>
    api.get(`/assets/devices/${id}/original-configuration/items`, {
      params,
      signal,
    }) as Promise<Envelope<PageData<OriginalConfigurationItemDTO>>>,
  getCurrentConfiguration: (id: string, expectedConfigurationVersion?: number, signal?: AbortSignal) =>
    api.get(`/assets/devices/${id}/current-configuration`, {
      params: expectedConfigurationVersion ? { expected_configuration_version: expectedConfigurationVersion } : undefined,
      signal,
    }) as Promise<Envelope<CurrentConfigurationSummaryDTO>>,
  listCurrentConfigurationItems: (
    id: string,
    params?: { page?: number; page_size?: number; expected_configuration_version?: number },
    signal?: AbortSignal,
  ) =>
    api.get(`/assets/devices/${id}/current-configuration/items`, {
      params,
      signal,
    }) as Promise<Envelope<PageData<CurrentConfigurationItemDTO>>>,
  getConfigurationDiff: (
    id: string,
    params?: {
      page?: number
      page_size?: number
      filter?: ConfigurationDiffKind
      expected_configuration_version?: number
    },
    signal?: AbortSignal,
  ) =>
    api.get(`/assets/devices/${id}/configuration-diff`, {
      params,
      signal,
    }) as Promise<Envelope<ConfigurationDiffResponseDTO>>,

  listComponents: (params?: AssetComponentListParams, signal?: AbortSignal) =>
    api.get("/assets/components", { params, signal }) as Promise<Envelope<PageData<AssetPartDetailDTO>>>,
  getComponent: (id: string, signal?: AbortSignal) =>
    api.get(`/assets/components/${id}`, { signal }) as Promise<Envelope<AssetPartDetailDTO>>,
  getComponentHistory: (id: string, params?: { page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get(`/assets/components/${id}/history`, { params, signal }) as Promise<Envelope<PageData<AssetActionDTO>>>,
  fillComponentSerialNumber: (
    id: string,
    expectedVersion: number,
    serialNumber: string,
    reason: string,
    idempotencyKey: string,
  ) =>
    api.patch(
      `/assets/components/${id}/serial-number`,
      {
        expected_version: expectedVersion,
        serial_number: serialNumber,
        reason,
      },
      { headers: idempotencyHeaders(idempotencyKey) },
    ) as Promise<Envelope<AssetPartDetailDTO>>,
}
