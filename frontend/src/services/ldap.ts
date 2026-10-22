import { api } from "./api";
import type { Envelope, PageData } from "./types";

export type DirectoryType = "ad" | "ldap";
export type DepartmentStrategy = "none" | "ou" | "attribute";
export type SyncMode = "full" | "incremental";
export type SyncStatus = "idle" | "running" | "success" | "partial" | "failed";

export interface AttributeMapping {
  username: string;
  email: string;
  nickname: string;
  department: string;
  external_id: string;
}

export interface OUMapping {
  ou_dn: string;
  department_id: string;
}

export interface DepartmentSyncOptions {
  strategy: DepartmentStrategy;
  root_department_id: string | null;
  ou_mappings: OUMapping[] | null;
}

export interface LDAPConfig {
  id: string;
  name: string;
  type: DirectoryType;
  domain: string;
  server_host: string;
  port: number;
  use_ssl: boolean;
  start_tls: boolean;
  insecure_skip_verify: boolean;
  bind_dn: string;
  base_dn: string;
  user_filter: string;
  attribute_mapping: AttributeMapping;
  department_sync: DepartmentSyncOptions;
  default_role_id: string | null;
  enabled: boolean;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  disable_missing_users: boolean;
  timeout_seconds: number;
  sync_status: SyncStatus;
  sync_started_at: string | null;
  sync_lease_expires_at: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  has_bind_password: boolean;
  created_at: string;
}

export interface LDAPConfigPayload {
  name: string;
  type: DirectoryType;
  domain: string;
  server_host: string;
  port: number;
  use_ssl: boolean;
  start_tls: boolean;
  insecure_skip_verify: boolean;
  bind_dn: string;
  bind_password: string;
  base_dn: string;
  user_filter: string;
  attribute_mapping: AttributeMapping;
  department_sync: DepartmentSyncOptions;
  default_role_id: string | null;
  enabled: boolean;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  disable_missing_users: boolean;
  timeout_seconds: number;
}

export interface LDAPTestResult {
  success: boolean;
  stage: "connect" | "bind" | "search" | "done";
  message: string;
  latency_ms: number;
  server_url: string;
  sample_users: string[];
}

export interface SyncPlanItem {
  action: "create" | "update" | "unchanged" | "disable" | "skip" | "conflict";
  username: string;
  nickname: string;
  email: string;
  dn: string;
  department: string;
  user_id?: string;
  changes?: string[];
  diff?: Array<{ field: string; before: string; after: string }>;
  reason?: string;
}

export interface SyncPlan {
  plan_id: string;
  config_id: string;
  domain: string;
  mode: SyncMode;
  generated_at: string;
  expires_at: string;
  config_revision: string;
  summary: {
    total: number;
    create: number;
    update: number;
    unchanged: number;
    disable: number;
    skip: number;
    conflict: number;
    departments_to_create: number;
  };
  items: SyncPlanItem[];
  departments_to_create: string[];
  truncated: boolean;
}

export interface SyncReport {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  disabled: number;
  skipped: number;
  failed: number;
  departments_created: number;
  errors: Array<{ username: string; dn: string; reason: string }> | null;
  errors_truncated: boolean;
}

export interface SyncLog {
  id: string;
  config_id: string;
  domain: string;
  trigger: "manual" | "schedule";
  mode: SyncMode;
  status: SyncStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  report: SyncReport;
  message: string;
  plan_id: string;
  phase: "preparing" | "planning" | "applying" | "finalizing";
  processed: number;
  total: number | null;
}

export const ldapService = {
  configs: (signal?: AbortSignal) =>
    api.get("/ldap/configs", { signal }) as Promise<Envelope<LDAPConfig[]>>,
  create: (payload: LDAPConfigPayload) =>
    api.post("/ldap/configs", payload) as Promise<Envelope<LDAPConfig>>,
  update: (id: string, payload: LDAPConfigPayload) =>
    api.put(`/ldap/configs/${id}`, payload) as Promise<Envelope<LDAPConfig>>,
  remove: (id: string) =>
    api.delete(`/ldap/configs/${id}`) as Promise<
      Envelope<{ deleted: boolean }>
    >,
  test: (payload: LDAPConfigPayload & { config_id?: string }) =>
    api.post("/ldap/test", payload, { timeout: 70000 }) as Promise<
      Envelope<LDAPTestResult>
    >,
  preview: (configId: string, mode: SyncMode, signal?: AbortSignal) =>
    api.post(
      "/ldap/preview",
      { config_id: configId, mode },
      { timeout: 120000, signal },
    ) as Promise<Envelope<SyncPlan>>,
  sync: (input: {
    configId: string;
    mode: SyncMode;
    planId: string;
    idempotencyKey: string;
  }) =>
    api.post("/ldap/sync", {
      config_id: input.configId,
      mode: input.mode,
      plan_id: input.planId,
      idempotency_key: input.idempotencyKey,
    }) as Promise<Envelope<SyncLog>>,
  planItems: (planId: string, page = 1, pageSize = 50, signal?: AbortSignal) =>
    api.get(`/ldap/sync-plans/${planId}/items`, {
      params: { page, page_size: pageSize },
      signal,
    }) as Promise<Envelope<PageData<SyncPlanItem>>>,
  syncLog: (id: string, signal?: AbortSignal) =>
    api.get(`/ldap/sync-logs/${id}`, { signal }) as Promise<Envelope<SyncLog>>,
  logs: (configId?: string, page = 1, pageSize = 10, signal?: AbortSignal) =>
    api.get("/ldap/sync-logs", {
      params: { config_id: configId, page, page_size: pageSize },
      signal,
    }) as Promise<Envelope<PageData<SyncLog>>>,
};
