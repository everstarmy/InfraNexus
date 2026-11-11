import { api } from "./api"
import type { Envelope, PageData } from "./types"

export interface ManagedBase {
  id: string
  code: string
  name: string
  status: number // 1: 启用, 2: 停用
  version: number
  description?: string
  created_at: string
  updated_at: string
}

export interface ManagedQueryParams {
  page?: number
  page_size?: number
  search?: string
  status?: number
  parent_id?: string
  security_zone_id?: string
  usage_type?: string
}

export interface ManagedReferenceCount {
  resource: string
  field: string
  count: number
}

export interface ManagedAuditSnapshot {
  certificate_type?: string
  certificate_no?: string
  issuer?: string
  level?: string
  valid_from?: string
  valid_until?: string
  evidence_ref?: string
}

export interface ManagedAuditFields {
  qualification?: ManagedAuditSnapshot
  code?: string
  status?: number
  version?: number
  reservation?: string
  evidence_ref?: string
  reason?: string
  conflict_id?: string
}

export interface ManagedAudit {
  id: string
  resource: string
  resource_id: string
  actor_id: string
  request_id: string
  action: string
  before: ManagedAuditFields
  after: ManagedAuditFields
  created_at: string
}

export interface ManagedImportError {
  row: number
  message: string
}

export interface ManagedImportResult<T> {
  items: T[]
  errors: ManagedImportError[]
}

export function newManagedIdempotencyKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("")
}

export function createManagedClient<T extends ManagedBase>(basePath: string) {
  return {
    list: (params?: ManagedQueryParams, signal?: AbortSignal) =>
      api.get(basePath, { params, signal }) as Promise<Envelope<PageData<T>>>,

    get: (id: string, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}`, { signal }) as Promise<Envelope<T>>,

    create: (data: Partial<T>, idempotencyKey?: string) =>
      api.post(basePath, data, {
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      }) as Promise<Envelope<T>>,

    update: (record: T, changes: Partial<T>) => {
      const { id, version, status: _status, created_at: _created, updated_at: _updated, ...current } = record
      return api.put(`${basePath}/${id}`, {
        expected_version: version,
        data: { ...current, ...changes },
      }) as Promise<Envelope<T>>
    },

    setStatus: (id: string, expectedVersion: number, status: number) =>
      api.patch(`${basePath}/${id}/status`, {
        expected_version: expectedVersion,
        status,
      }) as Promise<Envelope<T>>,

    remove: (id: string, expectedVersion: number) =>
      api.delete(`${basePath}/${id}`, {
        params: { expected_version: expectedVersion },
      }) as Promise<Envelope<{ deleted: boolean }>>,

    references: (id: string, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}/references`, { signal }) as Promise<
        Envelope<ManagedReferenceCount[]>
      >,

    history: (id: string, params?: ManagedQueryParams, signal?: AbortSignal) =>
      api.get(`${basePath}/${id}/history`, { params, signal }) as Promise<
        Envelope<PageData<ManagedAudit>>
      >,

    importPreview: (items: Partial<T>[]) =>
      api.post(`${basePath}/import/preview`, { items }) as Promise<
        Envelope<ManagedImportResult<T>>
      >,

    importCommit: (items: Partial<T>[], idempotencyKey: string) =>
      api.post(
        `${basePath}/import`,
        { items },
        {
          headers: { "Idempotency-Key": idempotencyKey },
        }
      ) as Promise<Envelope<ManagedImportResult<T>>>,

    export: (params?: ManagedQueryParams, signal?: AbortSignal) =>
      api.get(`${basePath}/export`, { params, signal }) as Promise<Envelope<T[]>>,
  }
}
