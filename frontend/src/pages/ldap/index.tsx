import { useConfirm } from "@/components/common/confirm-dialog";
import {
  QueryErrorState,
  QueryPlaceholderNotice,
  isForbiddenQueryError,
} from "@/components/common/query-error-state";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, formatRelative } from "@/lib/format";
import { notify } from "@/lib/notify";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  ldapService,
  type LDAPConfig,
  type LDAPTestResult,
  type SyncLog,
  type SyncMode,
  type SyncPlan,
} from "@/services/ldap";
import { optionsService } from "@/services/options";
import { useAuth } from "@/stores/auth-context";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  Eye,
  FileWarning,
  Hand,
  History,
  Lock,
  LogIn,
  Network,
  Pencil,
  Play,
  Plug,
  Plus,
  ShieldAlert,
  Timer,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LdapConfigDialog,
  fromConfig,
  type StudioTab,
} from "./components/ldap-config-sheet";
import { LdapConfigTable } from "./components/ldap-config-table";
import { LdapPreviewDialog } from "./components/ldap-preview-dialog";
import { LdapTaskDialog } from "./components/ldap-task-dialog";
import { SyncStatusBadge } from "./components/sync-status";

const strategyLabels = {
  ou: "OU 自动建树",
  attribute: "按部门属性",
  none: "不同步部门",
} as const;

function serverURL(cfg: LDAPConfig) {
  return `${cfg.use_ssl ? "ldaps" : "ldap"}://${cfg.server_host}:${cfg.port}`;
}

// Only public configuration values participate; stored credentials never enter this key.
function probeRevision(cfg: LDAPConfig) {
  return JSON.stringify([cfg.updated_at, fromConfig(cfg)]);
}

export default function LdapPage() {
  const { can, user } = useAuth();
  const canReadPlanItems = can("api:GET:/api/v1/ldap/sync-plans/:id/items");
  const canReadTaskDetails = can("api:GET:/api/v1/ldap/sync-logs/:id");
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<LDAPConfig | "new" | null>(null);
  const [editingTab, setEditingTab] = useState<StudioTab>("connection");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [probes, setProbes] = useState<
    Record<string, { revision: string; result: LDAPTestResult }>
  >({});
  const probeRequests = useRef(new Map<string, symbol>());
  const statusRequests = useRef(new Set<string>());

  const editConfig = useCallback(
    (config: LDAPConfig, tab: StudioTab = "connection") => {
      setEditingTab(tab);
      setEditing(config);
    },
    [],
  );

  const [previewing, setPreviewing] = useState<LDAPConfig | null>(null);
  const [previewMode, setPreviewMode] = useState<SyncMode>("full");
  const [errorsLog, setErrorsLog] = useState<SyncLog | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [togglingStatusIds, setTogglingStatusIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>(
    undefined,
  );
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const idempotencyKeys = useRef(new Map<string, string>());

  const configsQuery = useQuery({
    queryKey: queryKeys.ldapConfigs,
    queryFn: async ({ signal }) => (await ldapService.configs(signal)).data,
    refetchInterval: (q) =>
      q.state.data?.some((c) => c.sync_status === "running") ? 2000 : false,
  });
  const configsForbidden = isForbiddenQueryError(configsQuery.error);
  const configsUnavailable =
    configsQuery.isError && (!configsQuery.data || configsForbidden);
  const configs = useMemo(
    () => (configsForbidden ? [] : (configsQuery.data ?? [])),
    [configsQuery.data, configsForbidden],
  );
  const probeResults = useMemo(() => {
    const visible: Record<string, LDAPTestResult> = {};
    for (const cfg of configs) {
      const probe = probes[cfg.id];
      if (probe?.revision === probeRevision(cfg))
        visible[cfg.id] = probe.result;
    }
    return visible;
  }, [configs, probes]);

  const configSaved = useCallback(
    (saved: LDAPConfig) => {
      probeRequests.current.delete(saved.id);
      setProbes((previous) => {
        const next = { ...previous };
        delete next[saved.id];
        return next;
      });
      queryClient.setQueryData<LDAPConfig[]>(
        queryKeys.ldapConfigs,
        (previous) =>
          previous?.map((item) => (item.id === saved.id ? saved : item)),
      );
    },
    [queryClient],
  );

  const activeFilterConfigId = selectedConfigId;
  const filterRemoved =
    !!selectedConfigId &&
    configsQuery.isSuccess &&
    !configs.some((config) => config.id === selectedConfigId);

  useEffect(() => {
    if (!filterRemoved) return;
    setSelectedConfigId(undefined);
    setPagination((previous) => ({ ...previous, pageIndex: 0 }));
  }, [filterRemoved]);

  useEffect(() => {
    if (
      detailId &&
      configsQuery.isSuccess &&
      !configs.some((c) => c.id === detailId)
    ) {
      setDetailId(null);
    }
  }, [configs, configsQuery.isSuccess, detailId]);

  const running = configs.some((c) => c.sync_status === "running");

  const logsQuery = useQuery({
    enabled: !filterRemoved,
    queryKey: [
      ...queryKeys.ldapLogs(activeFilterConfigId),
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async ({ signal }) =>
      (
        await ldapService.logs(
          activeFilterConfigId,
          pagination.pageIndex + 1,
          pagination.pageSize,
          signal,
        )
      ).data,
    placeholderData: keepPreviousData,
    refetchInterval: running ? 2000 : false,
  });

  const deptQuery = useQuery({
    queryKey: queryKeys.departmentOptions,
    queryFn: async ({ signal }) =>
      (await optionsService.departments(signal)).data,
  });
  const rolesQuery = useQuery({
    queryKey: queryKeys.roleOptions,
    queryFn: async ({ signal }) => (await optionsService.roles(signal)).data,
  });
  const logsForbidden = isForbiddenQueryError(logsQuery.error);
  const logsUnavailable =
    logsQuery.isError && (!logsQuery.data || logsForbidden);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ldap"] });
    void queryClient.invalidateQueries({ queryKey: ["auth", "domains"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient]);

  const startSync = useMutation({
    mutationFn: ({
      cfg,
      mode,
      plan,
      idempotencyKey,
    }: {
      cfg: LDAPConfig;
      mode: SyncMode;
      plan: SyncPlan;
      idempotencyKey: string;
    }) =>
      ldapService.sync({
        configId: cfg.id,
        mode,
        planId: plan.plan_id,
        idempotencyKey,
      }),
    onSuccess: (_, { cfg, mode, plan }) => {
      idempotencyKeys.current.delete(plan.plan_id);
      notify.info(
        `${mode === "full" ? "全量" : "增量"}同步已开始`,
        `${cfg.domain} · 完成后结果将推送到通知中心`,
      );
      invalidate();
    },
    onError: (error, variables) => {
      if (
        (error as { response?: { status?: number } })?.response?.status === 409
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["ldap", "preview", variables.cfg.id, variables.mode],
        });
        notify.warning(
          "预览计划已失效",
          "配置、目录或本地资料已变化；已重新生成预览，请核对后再执行。",
        );
        return;
      }
      notify.apiError(error, "无法启动同步");
    },
  });

  const openPreview = useCallback((cfg: LDAPConfig, mode: SyncMode) => {
    setPreviewMode(mode);
    setPreviewing(cfg);
  }, []);

  const executePlan = (cfg: LDAPConfig, mode: SyncMode, plan: SyncPlan) => {
    const idempotencyKey =
      idempotencyKeys.current.get(plan.plan_id) ?? crypto.randomUUID();
    idempotencyKeys.current.set(plan.plan_id, idempotencyKey);
    const disableCount = plan.summary.disable;
    void confirm({
      tone: disableCount > 0 ? "destructive" : "default",
      title: `确认执行${mode === "full" ? "全量" : "增量"}同步？`,
      description:
        disableCount > 0
          ? `本次计划将停用 ${disableCount} 个账号。请确认已核对完整分页明细；本次执行将按预览计划处理，LDAP 后续变化由下一次同步处理。`
          : `将按已确认的预览计划处理 ${plan.summary.total} 个目录条目；LDAP 后续变化由下一次同步处理。`,
      details: (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-(length:--text-description)/5 text-muted-foreground">
          计划有效至 {formatDateTime(plan.expires_at, "yyyy-MM-dd HH:mm:ss")} ·
          新增 {plan.summary.create} · 更新 {plan.summary.update} · 不变{" "}
          {plan.summary.unchanged} · 停用 {disableCount} · 冲突{" "}
          {plan.summary.conflict}
        </p>
      ),
      confirmText:
        disableCount > 0
          ? `确认停用 ${disableCount} 个账号并同步`
          : "按此计划执行",
      onConfirm: async () => {
        await startSync.mutateAsync({ cfg, mode, plan, idempotencyKey });
        setPreviewing(null);
      },
    });
  };

  const testConnection = useCallback(
    async (cfg: LDAPConfig) => {
      const request = Symbol();
      probeRequests.current.set(cfg.id, request);
      const revision = probeRevision(cfg);
      setTesting(cfg.id);
      try {
        const res = await ldapService.test({
          ...fromConfig(cfg),
          config_id: cfg.id,
        });
        const current = queryClient
          .getQueryData<LDAPConfig[]>(queryKeys.ldapConfigs)
          ?.find((item) => item.id === cfg.id);
        if (
          probeRequests.current.get(cfg.id) !== request ||
          !current ||
          probeRevision(current) !== revision
        )
          return;
        setProbes((prev) => ({
          ...prev,
          [cfg.id]: { revision, result: res.data },
        }));
        if (res.data.success)
          notify.success(
            `连接正常 · ${res.data.latency_ms} ms`,
            res.data.message,
          );
        else notify.error("连接失败", res.data.message);
      } catch (error) {
        if (probeRequests.current.get(cfg.id) === request)
          notify.apiError(error, "测试连接失败");
      } finally {
        const latest = probeRequests.current.get(cfg.id);
        if (latest === request || latest === undefined)
          setTesting((current) => (current === cfg.id ? null : current));
        if (latest === request) probeRequests.current.delete(cfg.id);
      }
    },
    [queryClient],
  );

  const toggleStatus = useCallback(
    async (cfg: LDAPConfig, enabled: boolean) => {
      if (statusRequests.current.has(cfg.id)) return;
      statusRequests.current.add(cfg.id);
      setTogglingStatusIds((current) => new Set(current).add(cfg.id));
      try {
        await queryClient.cancelQueries({ queryKey: queryKeys.ldapConfigs });
        const result = await ldapService.toggleStatus(cfg.id, enabled);
        await queryClient.cancelQueries({ queryKey: queryKeys.ldapConfigs });
        queryClient.setQueryData<LDAPConfig[]>(
          queryKeys.ldapConfigs,
          (previous) =>
            previous?.map((item) =>
              item.id === cfg.id
                ? {
                    ...item,
                    enabled: result.data.enabled,
                    updated_at: result.data.updated_at,
                  }
                : item,
            ),
        );
        notify.success(
          enabled ? "已启用域账号登录" : "已禁用域账号登录",
          cfg.domain,
        );
        invalidate();
      } catch (error) {
        notify.apiError(error, "切换域账号登录状态失败");
      } finally {
        statusRequests.current.delete(cfg.id);
        setTogglingStatusIds((current) => {
          const next = new Set(current);
          next.delete(cfg.id);
          return next;
        });
      }
    },
    [invalidate, queryClient],
  );

  const remove = useCallback(
    (cfg: LDAPConfig) =>
      void confirm({
        title: `删除目录配置「${cfg.name}」？`,
        description: `删除后 ${cfg.domain} 的域账号将无法登录（本地档案保留），定时同步随之停止。`,
        confirmText: "确认删除",
        onConfirm: async () => {
          try {
            await ldapService.remove(cfg.id);
            notify.success("目录配置已删除", cfg.name);
            invalidate();
          } catch (error) {
            notify.apiError(error, "删除失败");
            throw error;
          }
        },
      }),
    [confirm, invalidate],
  );

  const inspectedConfig = useMemo(
    () => configs.find((c) => c.id === detailId) ?? null,
    [configs, detailId],
  );

  const logColumns = useMemo<ColumnDef<SyncLog>[]>(
    () => [
      {
        id: "started_at",
        size: 180,
        minSize: 160,
        accessorKey: "started_at",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="开始时间" />
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <p className="text-(length:--text-description)/5 font-medium whitespace-nowrap">
              {formatDateTime(row.original.started_at, "MM-dd HH:mm:ss")}
            </p>
            <p className="text-xs/4.5 text-muted-foreground">
              {formatRelative(row.original.started_at)}
            </p>
          </div>
        ),
      },
      {
        id: "domain",
        size: 200,
        minSize: 160,
        accessorKey: "domain",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="目录域" />
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <code className="font-mono text-(length:--text-description)/5">{row.original.domain}</code>
        ),
      },
      {
        id: "trigger",
        size: 130,
        minSize: 120,
        accessorKey: "trigger",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="触发 / 模式" />
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-(length:--text-description)/5">
            {row.original.trigger === "schedule" ? (
              <CalendarClock className="size-3.5 text-muted-foreground" />
            ) : (
              <Hand className="size-3.5 text-muted-foreground" />
            )}
            {row.original.trigger === "schedule" ? "定时" : "手动"} ·{" "}
            {row.original.mode === "full" ? "全量" : "增量"}
          </span>
        ),
      },
      {
        id: "status",
        size: 100,
        minSize: 88,
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="状态" />
        ),
        enableSorting: false,
        cell: ({ row }) => <SyncStatusBadge status={row.original.status} />,
      },
      {
        id: "result",
        accessorFn: (log) => log.report.total,
        enableSorting: false,
        size: 240,
        minSize: 200,
        header: "结果",
        cell: ({ row }) => {
          const r = row.original.report;
          if (row.original.status === "running") {
            const progress = row.original.total
              ? Math.min(
                  100,
                  Math.floor(
                    (row.original.processed / row.original.total) * 100,
                  ),
                )
              : null;
            const phaseLabel =
              {
                preparing: "准备中",
                planning: "校验计划",
                applying: "应用变更",
                finalizing: "收尾中",
              }[row.original.phase] ?? "同步中";
            return (
              <div
                className="min-w-36 space-y-1.5"
                aria-label={`同步${phaseLabel}`}
              >
                <div className="flex justify-between gap-3 text-(length:--text-description)/5 text-muted-foreground">
                  <span>{phaseLabel}</span>
                  <span>
                    {progress === null
                      ? "计算中…"
                      : `${row.original.processed} / ${row.original.total} · ${progress}%`}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress ?? undefined}
                  aria-valuetext={
                    progress === null ? "正在计算任务规模" : `${progress}%`
                  }
                >
                  <div
                    className={cn(
                      "h-full rounded-full bg-primary transition-[width] duration-300",
                      progress === null && "w-1/3 motion-safe:animate-pulse",
                    )}
                    style={
                      progress === null ? undefined : { width: `${progress}%` }
                    }
                  />
                </div>
              </div>
            );
          }
          if (row.original.status === "failed" && !r.total)
            return (
              <span
                className="max-w-64 truncate text-(length:--text-description)/5 text-destructive"
                title={row.original.message}
              >
                {row.original.message || "同步失败"}
              </span>
            );
          return (
            <div className="flex flex-wrap gap-1 text-xs/4.5">
              <Badge
                variant="outline"
                className="min-h-5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              >
                新增 {r.created}
              </Badge>
              <Badge
                variant="outline"
                className="min-h-5 border-sky-500/30 text-sky-700 dark:text-sky-300"
              >
                更新 {r.updated}
              </Badge>
              <Badge
                variant="outline"
                className="min-h-5 border-amber-500/30 text-amber-700 dark:text-amber-300"
              >
                停用 {r.disabled}
              </Badge>
              {r.failed > 0 && (
                <Badge
                  variant="outline"
                  className="min-h-5 border-rose-500/30 text-rose-700 dark:text-rose-300"
                >
                  失败 {r.failed}
                </Badge>
              )}
              {r.departments_created > 0 && (
                <Badge variant="secondary" className="h-4.5">
                  新部门 {r.departments_created}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "duration",
        size: 90,
        minSize: 80,
        accessorKey: "duration_ms",
        header: "耗时",
        cell: ({ row }) => (
          <span className="text-(length:--text-description)/5 text-muted-foreground tabular-nums">
            {row.original.finished_at
              ? `${(row.original.duration_ms / 1000).toFixed(1)} s`
              : "—"}
          </span>
        ),
      },
      {
        id: "actions",
        size: 96,
        minSize: 96,
        maxSize: 96,
        enableHiding: false,
        header: () => <span className="sr-only">详情</span>,
        cell: ({ row }) =>
          canReadTaskDetails ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={logsQuery.isPlaceholderData}
              onClick={() => {
                setErrorsLog(row.original);
              }}
            >
              <FileWarning />
              任务详情
            </Button>
          ) : null,
      },
    ],
    [canReadTaskDetails, logsQuery.isPlaceholderData],
  );

  const logFilters =
    configs.length > 4 ? (
      <Select
        value={activeFilterConfigId ?? "all"}
        items={[
          { value: "all", label: "全部域" },
          ...configs.map((cfg) => ({
            value: cfg.id,
            label: `${cfg.name}（${cfg.domain}）`,
          })),
        ]}
        onValueChange={(value) => {
          setSelectedConfigId(value === "all" ? undefined : String(value));
          setPagination((previous) => ({ ...previous, pageIndex: 0 }));
        }}
      >
        <SelectTrigger
          aria-label="按身份源域筛选同步日志"
          className="w-full sm:w-72"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">全部域</SelectItem>
            {configs.map((cfg) => (
              <SelectItem key={cfg.id} value={cfg.id}>
                {cfg.name}（{cfg.domain}）
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    ) : configs.length > 1 || selectedConfigId ? (
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="按身份源域筛选同步日志"
      >
        <Button
          size="xs"
          variant={activeFilterConfigId === undefined ? "secondary" : "ghost"}
          aria-pressed={activeFilterConfigId === undefined}
          onClick={() => {
            setSelectedConfigId(undefined);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        >
          全部域
        </Button>
        {configs.map((cfg) => (
          <Button
            key={cfg.id}
            size="xs"
            variant={activeFilterConfigId === cfg.id ? "secondary" : "ghost"}
            aria-pressed={activeFilterConfigId === cfg.id}
            className="h-auto min-h-7 max-w-full whitespace-normal break-all py-1 font-mono"
            onClick={() => {
              setSelectedConfigId(cfg.id);
              setPagination((prev) => ({
                ...prev,
                pageIndex: 0,
              }));
            }}
          >
            {cfg.domain}
          </Button>
        ))}
      </div>
    ) : undefined;

  const logHeading = (
    <div className="min-w-0 space-y-1">
      <CardTitle className="text-base/6">同步日志</CardTitle>
    </div>
  );

  const lastLog = logsQuery.isPlaceholderData
    ? undefined
    : logsQuery.data?.items[0];
  const activeRunningLog = useMemo(
    () => (logsQuery.data?.items ?? []).find((l) => l.status === "running"),
    [logsQuery.data?.items],
  );

  return (
    <>
      <StatGrid>
        <StatCard
          label="已接入身份源"
          value={configsUnavailable ? "—" : configs.length}
          icon={Waypoints}
          tone="primary"
          loading={configsQuery.isLoading}
          hint={
            configsUnavailable
              ? "目录数据不可用"
              : configs.length > 1
                ? `${configs.length} 个域独立配置，支持 AD / OpenLDAP`
                : configs[0]?.domain || "尚未接入"
          }
        />
        <StatCard
          label="允许域登录"
          value={configsUnavailable ? "—" : configs.filter((c) => c.enabled).length}
          icon={LogIn}
          tone="success"
          loading={configsQuery.isLoading}
          hint="登录页「企业域」可选的域数量"
        />
        <StatCard
          label="定时同步"
          value={configsUnavailable ? "—" : configs.filter((c) => c.sync_enabled).length}
          icon={Timer}
          tone="info"
          loading={configsQuery.isLoading}
          hint="由后台调度器自动执行全量同步"
        />
        <StatCard
          label={pagination.pageIndex > 0 ? "当前页最近同步" : "最近一次同步"}
          value={
            logsUnavailable
              ? "—"
              : lastLog
                ? formatRelative(lastLog.started_at)
                : "暂无"
          }
          icon={History}
          tone={
            lastLog?.status === "failed"
              ? "danger"
              : lastLog?.status === "partial"
                ? "warning"
                : "default"
          }
          loading={logsQuery.isLoading || logsQuery.isPlaceholderData}
          hint={
            lastLog
              ? `${lastLog.domain} · ${{ running: "进行中", success: "成功", partial: "部分失败", failed: "失败", idle: "—" }[lastLog.status]}`
              : undefined
          }
        />
      </StatGrid>

      {/* Active Running Sync Task Strip */}
      {activeRunningLog && (
        <Card className="border-sky-500/30 bg-sky-500/5 py-3 shadow-2xs">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-(length:--text-description)/5">
                <span className="font-medium text-foreground">
                  正在同步目录域 <code>{activeRunningLog.domain}</code> ·{" "}
                  {{
                    preparing: "准备中",
                    planning: "校验计划",
                    applying: "应用变更",
                    finalizing: "收尾中",
                  }[activeRunningLog.phase] ?? "同步中"}
                </span>
                <span className="font-mono text-muted-foreground tabular-nums">
                  {activeRunningLog.total
                    ? `${activeRunningLog.processed} / ${activeRunningLog.total} · ${Math.min(100, Math.floor((activeRunningLog.processed / activeRunningLog.total) * 100))}%`
                    : "计算中…"}
                </span>
              </div>
              {(() => {
                const progress = activeRunningLog.total
                  ? Math.min(
                      100,
                      Math.floor(
                        (activeRunningLog.processed / activeRunningLog.total) *
                          100,
                      ),
                    )
                  : null;
                return (
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress ?? undefined}
                    aria-valuetext={
                      progress === null ? "正在计算任务规模" : `${progress}%`
                    }
                  >
                    <div
                      className={cn(
                        "h-full rounded-full bg-primary transition-[width] duration-300",
                        progress === null && "w-1/3 motion-safe:animate-pulse",
                      )}
                      style={
                        progress === null
                          ? undefined
                          : { width: `${progress}%` }
                      }
                    />
                  </div>
                );
              })()}
            </div>
            <div className="flex items-center gap-2">
              {canReadTaskDetails && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setErrorsLog(activeRunningLog)}
                >
                  <FileWarning />
                  任务详情
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setLogsOpen(true)}
              >
                <History />
                查看日志
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {configsQuery.isError && configsQuery.data && !configsForbidden && (
        <QueryErrorState
          error={configsQuery.error}
          label="目录配置"
          onRetry={() => void configsQuery.refetch()}
          retrying={configsQuery.isFetching}
        />
      )}
      {deptQuery.isError && (
        <QueryErrorState
          error={deptQuery.error}
          label="部门映射选项"
          onRetry={() => void deptQuery.refetch()}
          retrying={deptQuery.isFetching}
        />
      )}
      {rolesQuery.isError && (
        <QueryErrorState
          error={rolesQuery.error}
          label="角色映射选项"
          onRetry={() => void rolesQuery.refetch()}
          retrying={rolesQuery.isFetching}
        />
      )}

      <section aria-label="目录配置" className="min-w-0 space-y-2.5">
        <Card size="sm" className="rounded-xl border border-border/80 bg-card shadow-xs">
          <CardContent className="p-2 sm:p-2.5">
            {configsUnavailable ? (
              <QueryErrorState
                error={configsQuery.error}
                label="目录配置"
                onRetry={() => void configsQuery.refetch()}
                retrying={configsQuery.isFetching}
              />
            ) : (
              <LdapConfigTable
                configs={configs}
                loading={configsQuery.isLoading}
                can={can}
                testing={testing}
                togglingStatusIds={togglingStatusIds}
                selectedId={detailId}
                probeResults={probeResults}
                onDetails={(cfg) =>
                  setDetailId((previous) =>
                    previous === cfg.id ? null : cfg.id,
                  )
                }
                onToggleStatus={(cfg, enabled) =>
                  void toggleStatus(cfg, enabled)
                }
                onEdit={editConfig}
                onTest={(cfg) => void testConnection(cfg)}
                onPreview={(cfg) => openPreview(cfg, "full")}
                onLogs={(cfg) => {
                  setSelectedConfigId(cfg.id);
                  setPagination((previous) => ({ ...previous, pageIndex: 0 }));
                  setLogsOpen(true);
                }}
                onRemove={remove}
                onRefresh={() => void configsQuery.refetch()}
                refreshing={configsQuery.isFetching}
                actions={
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedConfigId(undefined);
                        setLogsOpen(true);
                      }}
                    >
                      <History />
                      同步日志
                      {running && (
                        <span className="size-2 rounded-full bg-sky-500 motion-safe:animate-pulse" />
                      )}
                    </Button>
                    {can("ldap:create") && (
                      <Button
                        size="icon"
                        onClick={() => {
                          setEditingTab("connection");
                          setEditing("new");
                        }}
                        disabled={configsQuery.isError}
                        title="新建目录配置"
                        aria-label="新建目录配置"
                      >
                        <Plus />
                      </Button>
                    )}
                  </>
                }
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Selected Domain Detail Sidebar (Sheet) */}
      <Sheet
        open={inspectedConfig !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
      >
        <SheetContent
          side="right"
          aria-label="目录配置详情"
          className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          {inspectedConfig && (
            <>
              <SheetHeader className="border-b bg-muted/25 p-5 pr-12">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
                      inspectedConfig.type === "ad"
                        ? "bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-300"
                        : "bg-violet-500/10 text-violet-600 ring-violet-500/20 dark:text-violet-300",
                    )}
                  >
                    {inspectedConfig.type === "ad" ? (
                      <Building2 className="size-5" />
                    ) : (
                      <Network className="size-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <SheetTitle className="break-words text-lg/6.5 font-semibold">
                      {inspectedConfig.name}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                      {inspectedConfig.domain} 目录配置详情
                    </SheetDescription>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="font-mono">
                        {inspectedConfig.domain}
                      </Badge>
                      <Badge variant="secondary">
                        {inspectedConfig.type === "ad"
                          ? "Active Directory"
                          : "OpenLDAP"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          inspectedConfig.use_ssl || inspectedConfig.start_tls
                            ? "gap-1 border-sky-500/30 text-sky-700 dark:text-sky-300"
                            : "text-muted-foreground"
                        }
                      >
                        {(inspectedConfig.use_ssl ||
                          inspectedConfig.start_tls) && (
                          <Lock className="size-3" />
                        )}
                        {inspectedConfig.use_ssl
                          ? "LDAPS 加密"
                          : inspectedConfig.start_tls
                            ? "StartTLS 加密"
                            : "明文 LDAP"}
                      </Badge>
                      {inspectedConfig.insecure_skip_verify && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-amber-500/30 text-amber-700 dark:text-amber-300"
                        >
                          <ShieldAlert className="size-3" />
                          跳过证书校验
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                  <div className="space-y-0.5">
                    <p className="text-(length:--text-description)/5 font-medium text-foreground">
                      域账号登录状态
                    </p>
                    <p className="text-xs/4.5 text-muted-foreground">
                      {inspectedConfig.enabled
                        ? "已开启，登录页「企业 AD 域账号」可选中该域"
                        : "已关闭，该域成员暂停通过域密码登录"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={inspectedConfig.enabled}
                      disabled={
                        !can("api:PATCH:/api/v1/ldap/configs/:id/status") ||
                        togglingStatusIds.has(inspectedConfig.id)
                      }
                      onCheckedChange={(checked) =>
                        void toggleStatus(inspectedConfig, checked)
                      }
                      aria-label={`侧栏切换 ${inspectedConfig.domain} 的域账号登录`}
                    />
                    <Badge
                      variant={
                        inspectedConfig.enabled ? "secondary" : "outline"
                      }
                    >
                      {inspectedConfig.enabled ? "允许登录" : "禁止登录"}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                  <div className="flex items-center justify-between gap-2 text-xs/4.5 text-muted-foreground">
                    <span>服务器端点</span>
                    <span className="font-mono tabular-nums">
                      超时 {inspectedConfig.timeout_seconds}s
                    </span>
                  </div>
                  <p
                    className="truncate font-mono text-(length:--text-description)/5 font-medium text-foreground"
                    title={serverURL(inspectedConfig)}
                  >
                    {serverURL(inspectedConfig)}
                  </p>
                  <div className="border-t border-border/60 pt-2.5">
                    <p className="text-xs/4.5 text-muted-foreground">
                      搜索基准 (Base DN)
                    </p>
                    <p
                      className="mt-0.5 break-all font-mono text-(length:--text-description)/5 text-foreground"
                      title={inspectedConfig.base_dn}
                    >
                      {inspectedConfig.base_dn}
                    </p>
                  </div>
                  {inspectedConfig.bind_dn && (
                    <div className="border-t border-border/60 pt-2.5">
                      <p className="text-xs/4.5 text-muted-foreground">
                        服务绑定账号 (Bind DN)
                      </p>
                      <p
                        className="mt-0.5 break-all font-mono text-(length:--text-description)/5 text-muted-foreground"
                        title={inspectedConfig.bind_dn}
                      >
                        {inspectedConfig.bind_dn}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                  <p className="text-xs/4.5 text-muted-foreground">
                    用户过滤器与属性映射规则
                  </p>
                  <p
                    className="break-all font-mono text-(length:--text-description)/5 text-foreground"
                    title={inspectedConfig.user_filter}
                  >
                    {inspectedConfig.user_filter}
                  </p>
                  <div className="border-t border-border/60 pt-2.5">
                    <div className="flex flex-wrap gap-1.5 text-xs/4.5">
                      <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5">
                        <span className="text-muted-foreground">账号</span>
                        <code className="font-mono">
                          {inspectedConfig.attribute_mapping.username}
                        </code>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5">
                        <span className="text-muted-foreground">姓名</span>
                        <code className="font-mono">
                          {inspectedConfig.attribute_mapping.nickname}
                        </code>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5">
                        <span className="text-muted-foreground">邮箱</span>
                        <code className="font-mono">
                          {inspectedConfig.attribute_mapping.email}
                        </code>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5">
                        <span className="text-muted-foreground">标识</span>
                        <code className="font-mono">
                          {inspectedConfig.attribute_mapping.external_id}
                        </code>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                  <div>
                    <p className="text-xs/4.5 text-muted-foreground">
                      组织架构映射
                    </p>
                    <p className="mt-0.5 text-(length:--text-description)/5 font-semibold text-foreground">
                      {strategyLabels[
                        inspectedConfig.department_sync.strategy
                      ] ?? "不同步部门"}
                    </p>
                    <p className="mt-0.5 text-xs/4.5 text-muted-foreground">
                      {inspectedConfig.department_sync.strategy === "ou"
                        ? (inspectedConfig.department_sync.ou_mappings
                            ?.length ?? 0) > 0
                          ? `含 ${inspectedConfig.department_sync.ou_mappings?.length} 条显式 OU 映射`
                          : "按 OU 层级自动生成部门树"
                        : inspectedConfig.department_sync.strategy ===
                            "attribute"
                          ? `按 ${inspectedConfig.attribute_mapping.department || "department"} 属性归类`
                          : "仅同步人员，本地维护部门"}
                    </p>
                  </div>
                  <div className="border-t border-border/60 pt-2.5">
                    <p className="text-xs/4.5 text-muted-foreground">
                      同步调度与回收
                    </p>
                    <p className="mt-0.5 text-(length:--text-description)/5 font-semibold text-foreground">
                      {inspectedConfig.sync_enabled
                        ? `每 ${inspectedConfig.sync_interval_minutes} 分钟同步`
                        : "手动同步"}
                    </p>
                    <p className="mt-0.5 text-xs/4.5 text-muted-foreground">
                      {inspectedConfig.disable_missing_users
                        ? "目录缺失账号自动停用"
                        : "目录缺失账号保留现状"}
                    </p>
                  </div>
                </div>
              </div>

              <SheetFooter className="border-t bg-muted/30 p-4">
                <div className="flex w-full flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--text-description)/5 text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <SyncStatusBadge status={inspectedConfig.sync_status} />
                      <span className="whitespace-nowrap">
                        上次同步 {formatRelative(inspectedConfig.last_sync_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {can("ldap:update") && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => editConfig(inspectedConfig)}
                        >
                          <Pencil className="size-3.5" />
                          编辑配置
                        </Button>
                      )}
                      {can("ldap:delete") && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(inspectedConfig)}
                        >
                          <Trash2 className="size-3.5" />
                          删除
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelectedConfigId(inspectedConfig.id);
                        setPagination((prev) => ({ ...prev, pageIndex: 0 }));
                        setDetailId(null);
                        setLogsOpen(true);
                      }}
                    >
                      <History />
                      该域同步日志
                    </Button>
                    {can("ldap:test") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void testConnection(inspectedConfig)}
                        disabled={testing === inspectedConfig.id}
                      >
                        {testing === inspectedConfig.id ? (
                          <Spinner />
                        ) : (
                          <Plug />
                        )}
                        测试连接
                      </Button>
                    )}
                    {can("ldap:sync") && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewing(inspectedConfig)}
                        >
                          <Eye />
                          预览同步
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                size="sm"
                                disabled={
                                  inspectedConfig.sync_status === "running" ||
                                  startSync.isPending
                                }
                              />
                            }
                          >
                            {inspectedConfig.sync_status === "running" ? (
                              <Spinner />
                            ) : (
                              <Play />
                            )}
                            立即同步
                            <ChevronDown />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() =>
                                openPreview(inspectedConfig, "full")
                              }
                            >
                              全量同步
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                openPreview(inspectedConfig, "incremental")
                              }
                              disabled={!inspectedConfig.last_success_at}
                            >
                              增量同步
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Stepper Configuration Dialog (Create & Edit) */}
      <LdapConfigDialog
        open={editing !== null}
        initialTab={editingTab}
        config={editing === "new" ? null : editing}
        departments={deptQuery.data?.items ?? []}
        roles={rolesQuery.data ?? []}
        optionsLoading={deptQuery.isLoading || rolesQuery.isLoading}
        optionsError={deptQuery.error ?? rolesQuery.error}
        onRetryOptions={() => {
          void deptQuery.refetch();
          void rolesQuery.refetch();
        }}
        onSaved={configSaved}
        onOpenChange={(open) => !open && setEditing(null)}
      />

      {/* Sync Logs Dialog */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent
          aria-label="同步日志"
          className="flex h-[88svh] max-h-[88svh] flex-col gap-0 p-0 sm:max-w-5xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>同步日志</DialogTitle>
            <DialogDescription className="text-(length:--text-description)/5">
              查看各目录域的同步任务执行报表与失败明细
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5 pr-12">
            {logsQuery.isError && logsQuery.data && !logsForbidden && (
              <QueryErrorState
                error={logsQuery.error}
                label="同步日志"
                onRetry={() => void logsQuery.refetch()}
                retrying={logsQuery.isFetching}
              />
            )}
            {logsQuery.isPlaceholderData && (
              <QueryPlaceholderNotice label="同步日志" />
            )}
            {logsUnavailable ? (
              <>
                {logHeading}
                {logFilters}
                <QueryErrorState
                  error={logsQuery.error}
                  label="同步日志"
                  onRetry={() => void logsQuery.refetch()}
                  retrying={logsQuery.isFetching}
                />
              </>
            ) : (
              <DataTable
                viewport={{ mode: "fill", pending: logsQuery.isPlaceholderData, queryKey: selectedConfigId ?? "all" }}
                layoutControls={{ density: true }}
                toolbarTitle={logHeading}
                searchLeading={logFilters}
                columnLabels={{
                  started_at: "开始时间",
                  domain: "目录域",
                  trigger: "触发 / 模式",
                  status: "状态",
                  result: "结果",
                  duration: "耗时",
                }}
                columns={logColumns}
                data={logsQuery.data?.items ?? []}
                loading={logsQuery.isLoading}
                getRowId={(l) => l.id}
                serverFiltering
                enableColumnPinning
                enableColumnResizing
                initialColumnPinning={{
                  start: ["started_at"],
                  end: ["actions"],
                }}
                tablePreference={
                  user?.id
                    ? {
                        userId: user.id,
                        tableId: "ldap-sync-logs",
                        schemaVersion: 1,
                      }
                    : undefined
                }
                hideSearch
                serverPagination={{
                  pageIndex: pagination.pageIndex,
                  pageSize: pagination.pageSize,
                  total: logsQuery.data?.total ?? 0,
                  onChange: setPagination,
                }}
                onRefresh={() => void logsQuery.refetch()}
                isRefreshing={logsQuery.isFetching}
                emptyTitle="暂无同步记录"
                emptyDescription="执行一次手动同步或开启定时同步后，报表会出现在这里"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LdapPreviewDialog
        config={previewing}
        canRun={can("ldap:sync") && canReadPlanItems}
        canReadDetails={canReadPlanItems}
        initialMode={previewMode}
        onOpenChange={(open) => !open && setPreviewing(null)}
        onRun={executePlan}
      />
      <LdapTaskDialog
        key={errorsLog?.id ?? "closed"}
        log={errorsLog}
        configs={configs}
        canReadPlanItems={canReadPlanItems}
        onClose={() => setErrorsLog(null)}
        onRetry={openPreview}
      />
    </>
  );
}
