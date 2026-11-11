import { api } from "./api"
import { createManagedClient, type ManagedAudit, type ManagedBase } from "./managed"
import type { Envelope, PageData } from "./types"

export interface NetworkScopeDTO extends ManagedBase {
  routing_domain_ref?: string
}

export interface SecurityZoneDTO extends ManagedBase {
  datacenter_id: string
}

export type SubnetUsageType =
  | "bmc"
  | "storage_management"
  | "business_management"
  | "production"
  | "heartbeat"
  | "vip"
  | "other"

export interface SubnetDTO extends ManagedBase {
  network_scope_id: string
  security_zone_id: string
  cidr: string
  prefix_length?: number
  network_start?: number
  network_end?: number
  gateway?: string
  vlan_id?: number | null
  usage_type: SubnetUsageType
  dns_servers?: string[]
  is_allocatable: boolean
}

export type IPAllocationState = "free" | "reserved" | "in_use" | "quarantined"

export interface IPAddressView {
  id?: string
  address: string
  allocation_state: IPAllocationState
  reservation_kind: "none" | "manual" | "network" | "broadcast" | "gateway"
  cooldown_until?: string | null
  conflicted: boolean
  available: boolean
  version: number
}

export interface IPConflict {
  id: string
  address_id: string
  observed_identity: string
  evidence_ref: string
  observed_at: string
  reported_by: string
  resolved_at?: string | null
  resolved_by?: string | null
  resolution_reason?: string | null
}

export const networkScopesService = createManagedClient<NetworkScopeDTO>(
  "/ipam/network-scopes"
)

export const securityZonesService = createManagedClient<SecurityZoneDTO>(
  "/ipam/security-zones"
)

const baseSubnetsClient = createManagedClient<SubnetDTO>("/ipam/subnets")
export const subnetsService = {
  ...baseSubnetsClient,
  addresses: (
    subnetId: string,
    page = 1,
    pageSize = 64,
    signal?: AbortSignal
  ) =>
    api.get(`/ipam/subnets/${subnetId}/addresses`, {
      params: { page, page_size: pageSize },
      signal,
    }) as Promise<Envelope<PageData<IPAddressView>>>,

  addressDetail: (subnetId: string, address: string, signal?: AbortSignal) =>
    api.get(`/ipam/subnets/${subnetId}/addresses/${address}`, {
      signal,
    }) as Promise<Envelope<IPAddressView>>,

  reserveAddress: (
    subnetId: string,
    address: string,
    expectedVersion: number,
    reserved: boolean,
    reason: string
  ) =>
    api.patch(`/ipam/subnets/${subnetId}/addresses/${address}/reservation`, {
      expected_version: expectedVersion,
      reserved,
      reason,
    }) as Promise<Envelope<IPAddressView>>,

  addressHistory: (
    subnetId: string,
    address: string,
    page = 1,
    pageSize = 25,
    signal?: AbortSignal
  ) =>
    api.get(`/ipam/subnets/${subnetId}/addresses/${address}/history`, {
      params: { page, page_size: pageSize },
      signal,
    }) as Promise<Envelope<PageData<ManagedAudit>>>,

  addressConflicts: (
    subnetId: string,
    address: string,
    page = 1,
    pageSize = 25,
    signal?: AbortSignal
  ) =>
    api.get(`/ipam/subnets/${subnetId}/addresses/${address}/conflicts`, {
      params: { page, page_size: pageSize },
      signal,
    }) as Promise<Envelope<PageData<IPConflict>>>,

  reportConflict: (
    subnetId: string,
    address: string,
    data: { observed_identity: string; evidence_ref: string; observed_at: string },
    idempotencyKey?: string
  ) =>
    api.post(`/ipam/subnets/${subnetId}/addresses/${address}/conflicts`, data, {
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }) as Promise<Envelope<IPConflict>>,

  resolveConflict: (
    subnetId: string,
    address: string,
    conflictId: string,
    reason: string
  ) =>
    api.patch(
      `/ipam/subnets/${subnetId}/addresses/${address}/conflicts/${conflictId}/resolve`,
      { reason }
    ) as Promise<Envelope<{ resolved: boolean }>>,
}
