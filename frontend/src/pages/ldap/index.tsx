import { useConfirm } from "@/components/common/confirm-dialog";
import { PageHeader } from "@/components/common/page-header";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, formatRelative } from "@/lib/format";
import { notify } from "@/lib/notify";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  ldapService,
  type LDAPConfig,
  type SyncLog,
  type SyncMode,
  type SyncPlan,
} from "@/services/ldap";
import { optionsService } from "@/services/options";
import { useAuth } from "@/stores/auth-context";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  Eye,
  FileWarning,
  FolderSync,
  Hand,
  History,
  LogIn,
  MoreHorizontal,
  Network,
  Pencil,
  Play,
  Plug,
  Plus,
  ShieldAlert,
  Timer,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { LdapConfigSheet, fromConfig } from "./components/ldap-config-sheet";
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

export default function LdapPage() {
  const { can } = useAuth();
  const canReadPlanItems = can("api:GET:/api/v1/ldap/sync-plans/:id/items");
  const canReadTaskDetails = can("api:GET:/api/v1/ldap/sync-logs/:id");
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LDAPConfig | "new" | null>(null);
  const [previewing, setPreviewing] = useState<LDAPConfig | null>(null);
  const [previewMode, setPreviewMode] = useState<SyncMode>("full");
  const [errorsLog, setErrorsLog] = useState<SyncLog | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
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
  const running = configs.some((c) => c.sync_status === "running");

  const logsQuery = useQuery({
    queryKey: [
      ...queryKeys.ldapLogs(),
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async ({ signal }) =>
      (
        await ldapService.logs(
          undefined,
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

  const openPreview = (cfg: LDAPConfig, mode: SyncMode) => {
    setPreviewMode(mode);
    setPreviewing(cfg);
  };

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
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
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

  const testConnection = async (cfg: LDAPConfig) => {
    setTesting(cfg.id);
    try {
      const res = await ldapService.test({
        ...fromConfig(cfg),
        config_id: cfg.id,
      });
      if (res.data.success)
        notify.success(
          `连接正常 · ${res.data.latency_ms} ms`,
          res.data.message,
        );
      else notify.error("连接失败", res.data.message);
    } catch (error) {
      notify.apiError(error, "测试连接失败");
    } finally {
      setTesting(null);
    }
  };

  const remove = (cfg: LDAPConfig) =>
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
    });

  const logColumns = useMemo<ColumnDef<SyncLog>[]>(
    () => [
      {
        id: "started_at",
        accessorKey: "started_at",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="开始时间" />
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <p className="text-xs font-medium whitespace-nowrap">
              {formatDateTime(row.original.started_at, "MM-dd HH:mm:ss")}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatRelative(row.original.started_at)}
            </p>
          </div>
        ),
      },
      {
        id: "domain",
        accessorKey: "domain",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="目录域" />
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <code className="font-mono text-xs">{row.original.domain}</code>
        ),
      },
      {
        id: "trigger",
        accessorKey: "trigger",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="触发 / 模式" />
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-xs">
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
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="状态" />
        ),
        enableSorting: false,
        cell: ({ row }) => <SyncStatusBadge status={row.original.status} />,
      },
      {
        id: "result",
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
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
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
                className="max-w-64 truncate text-xs text-destructive"
                title={row.original.message}
              >
                {row.original.message || "同步失败"}
              </span>
            );
          return (
            <div className="flex flex-wrap gap-1 text-[11px]">
              <Badge
                variant="outline"
                className="h-4.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              >
                新增 {r.created}
              </Badge>
              <Badge
                variant="outline"
                className="h-4.5 border-sky-500/30 text-sky-700 dark:text-sky-300"
              >
                更新 {r.updated}
              </Badge>
              <Badge
                variant="outline"
                className="h-4.5 border-amber-500/30 text-amber-700 dark:text-amber-300"
              >
                停用 {r.disabled}
              </Badge>
              {r.failed > 0 && (
                <Badge
                  variant="outline"
                  className="h-4.5 border-rose-500/30 text-rose-700 dark:text-rose-300"
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
        accessorKey: "duration_ms",
        header: "耗时",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.original.finished_at
              ? `${(row.original.duration_ms / 1000).toFixed(1)} s`
              : "—"}
          </span>
        ),
      },
      {
        id: "actions",
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

  const lastLog = logsQuery.data?.items[0];

  return (
    <>
      <PageHeader
        icon={FolderSync}
        title="目录同步"
        description="对接 Windows AD / LDAP：域账号登录、组织架构映射与定时同步"
        badge={
          configsUnavailable ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"
              role="status"
            >
              目录状态暂不可用
            </span>
          ) : configs.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
              已接入 {configs.length} 个目录源
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse" />
              尚未接入
            </span>
          )
        }
        actions={
          can("ldap:create") && (
            <Button
              onClick={() => setEditing("new")}
              disabled={configsQuery.isError}
            >
              <Plus />
              新建目录配置
            </Button>
          )
        }
      />

      <StatGrid>
        <StatCard
          label="目录配置"
          value={configsUnavailable ? "—" : configs.length}
          icon={Network}
          tone="primary"
          loading={configsQuery.isLoading}
          hint={
            configsUnavailable
              ? "目录数据不可用"
              : configs.map((c) => c.domain).join(" · ") || "尚未接入"
          }
        />
        <StatCard
          label="允许域登录"
          value={
            configsUnavailable ? "—" : configs.filter((c) => c.enabled).length
          }
          icon={LogIn}
          tone="success"
          loading={configsQuery.isLoading}
          hint="登录页「企业域」可选的域数量"
        />
        <StatCard
          label="定时同步"
          value={
            configsUnavailable
              ? "—"
              : configs.filter((c) => c.sync_enabled).length
          }
          icon={Timer}
          tone="info"
          loading={configsQuery.isLoading}
          hint="由后台调度器自动执行全量同步"
        />
        <StatCard
          label="最近一次同步"
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
          loading={logsQuery.isLoading}
          hint={
            lastLog
              ? `${lastLog.domain} · ${{ running: "进行中", success: "成功", partial: "部分失败", failed: "失败", idle: "—" }[lastLog.status]}`
              : undefined
          }
        />
      </StatGrid>

      {configsQuery.isError && configsQuery.data && !configsForbidden && (
        <QueryErrorState
          error={configsQuery.error}
          label="目录配置"
          onRetry={() => void configsQuery.refetch()}
          retrying={configsQuery.isFetching}
        />
      )}
      {logsQuery.isError && logsQuery.data && !logsForbidden && (
        <QueryErrorState
          error={logsQuery.error}
          label="同步日志"
          onRetry={() => void logsQuery.refetch()}
          retrying={logsQuery.isFetching}
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

      {configsQuery.isLoading ? (
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-12 h-44 rounded-xl xl:col-span-6" />
          <Skeleton className="col-span-12 h-44 rounded-xl xl:col-span-6" />
        </div>
      ) : configsUnavailable ? (
        <QueryErrorState
          error={configsQuery.error}
          label="目录配置"
          onRetry={() => void configsQuery.refetch()}
          retrying={configsQuery.isFetching}
        />
      ) : configs.length === 0 ? (
        <Card className="col-span-12 overflow-hidden border border-border/80 bg-gradient-to-b from-card via-card to-muted/20 p-8 shadow-xs sm:p-10">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/15 via-violet-500/10 to-primary/10 text-sky-600 shadow-sm ring-1 ring-sky-500/20 dark:text-sky-300">
              <Building2 className="size-7" />
            </div>

            <h3 className="mt-4 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              连接企业身份源 (Active Directory / OpenLDAP)
            </h3>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground leading-relaxed">
              将现有的 Windows AD 或 LDAP 目录服务接入
              InfraNexus，实现企业员工域账号免注册登录与部门组织树全自动映射。
            </p>

            <div className="my-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 text-left">
              <div className="rounded-xl border border-border/70 bg-muted/40 p-4 transition-colors hover:border-primary/30">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-mono">
                    1
                  </span>
                  直连目录服务器
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-normal">
                  支持 LDAPS (SSL/TLS) 加密连接，自适应各类 Base DN 与过滤规则。
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/40 p-4 transition-colors hover:border-primary/30">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-mono">
                    2
                  </span>
                  统一账号与组织映射
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-normal">
                  sAMAccountName、mail 等属性映射，OU 自动生成平台部门层级。
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/40 p-4 transition-colors hover:border-primary/30">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-mono">
                    3
                  </span>
                  定时与增量同步
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-normal">
                  后台调度器按分钟级全量/增量拉取，人员调动离职权限秒级收回。
                </p>
              </div>
            </div>

            {can("ldap:create") && (
              <Button
                size="lg"
                onClick={() => setEditing("new")}
                className="gap-2 shadow-xs"
              >
                <Plus className="size-4" />
                新建第一个目录配置
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {configs.map((cfg) => (
            <Card
              key={cfg.id}
              className="col-span-12 gap-0 overflow-hidden py-0 2xl:col-span-6 border border-border/80 shadow-xs hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-3 p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-xl",
                      cfg.type === "ad"
                        ? "bg-sky-500/10 text-sky-600 dark:text-sky-300"
                        : "bg-violet-500/10 text-violet-600 dark:text-violet-300",
                    )}
                  >
                    {cfg.type === "ad" ? (
                      <Building2 className="size-5" />
                    ) : (
                      <Network className="size-5" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold tracking-tight">
                        {cfg.name}
                      </h3>
                      <Badge variant="outline" className="font-mono">
                        {cfg.domain}
                      </Badge>
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {serverURL(cfg)} · {cfg.base_dn}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Badge variant="secondary">
                        {cfg.type === "ad" ? "Active Directory" : "LDAP"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          cfg.enabled
                            ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                            : "text-muted-foreground"
                        }
                      >
                        {cfg.enabled ? "允许域登录" : "域登录已关闭"}
                      </Badge>
                      <Badge variant="outline">
                        {cfg.sync_enabled
                          ? `每 ${cfg.sync_interval_minutes} 分钟同步`
                          : "手动同步"}
                      </Badge>
                      <Badge variant="outline">
                        {strategyLabels[cfg.department_sync.strategy] ??
                          "不同步部门"}
                      </Badge>
                      {(cfg.use_ssl || cfg.start_tls) && (
                        <Badge variant="outline">
                          {cfg.use_ssl ? "LDAPS" : "StartTLS"}
                        </Badge>
                      )}
                      {cfg.insecure_skip_verify && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-amber-500/30 text-amber-700 dark:text-amber-300"
                        >
                          <ShieldAlert />
                          跳过证书校验
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {(can("ldap:update") || can("ldap:delete")) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${cfg.name} 的操作`}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {can("ldap:update") && (
                        <DropdownMenuItem onClick={() => setEditing(cfg)}>
                          <Pencil />
                          编辑配置
                        </DropdownMenuItem>
                      )}
                      {can("ldap:delete") && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => remove(cfg)}
                          >
                            <Trash2 />
                            删除配置
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <SyncStatusBadge status={cfg.sync_status} />
                  <span>上次同步 {formatRelative(cfg.last_sync_at)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {can("ldap:test") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void testConnection(cfg)}
                      disabled={testing === cfg.id}
                    >
                      {testing === cfg.id ? <Spinner /> : <Plug />}
                      测试连接
                    </Button>
                  )}
                  {can("ldap:sync") && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewing(cfg)}
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
                                cfg.sync_status === "running" ||
                                startSync.isPending
                              }
                            />
                          }
                        >
                          {cfg.sync_status === "running" ? (
                            <Spinner />
                          ) : (
                            <Play />
                          )}
                          立即同步
                          <ChevronDown />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onClick={() => openPreview(cfg, "full")}
                          >
                            全量同步
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openPreview(cfg, "incremental")}
                            disabled={!cfg.last_success_at}
                          >
                            增量同步
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-sm">同步日志</CardTitle>
          <CardDescription className="text-xs">
            每次同步的报表：新增、更新、停用与失败明细
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logsQuery.isPlaceholderData && (
            <QueryPlaceholderNotice label="同步日志" />
          )}
          {logsUnavailable ? (
            <QueryErrorState
              error={logsQuery.error}
              label="同步日志"
              onRetry={() => void logsQuery.refetch()}
              retrying={logsQuery.isFetching}
            />
          ) : (
            <DataTable
              columns={logColumns}
              data={logsQuery.data?.items ?? []}
              loading={logsQuery.isLoading}
              getRowId={(l) => l.id}
              serverFiltering
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
        </CardContent>
      </Card>

      <LdapConfigSheet
        open={editing !== null}
        config={editing === "new" ? null : editing}
        departments={deptQuery.data?.items ?? []}
        roles={rolesQuery.data ?? []}
        optionsLoading={deptQuery.isLoading || rolesQuery.isLoading}
        optionsError={deptQuery.error ?? rolesQuery.error}
        onRetryOptions={() => {
          void deptQuery.refetch();
          void rolesQuery.refetch();
        }}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <LdapPreviewDialog
        config={previewing}
        canRun={can("ldap:sync") && canReadPlanItems}
        canReadDetails={canReadPlanItems}
        initialMode={previewMode}
        onOpenChange={(open) => !open && setPreviewing(null)}
        onRun={executePlan}
      />
      <LdapTaskDialog key={errorsLog?.id ?? "closed"} log={errorsLog} configs={configs} canReadPlanItems={canReadPlanItems}
        onClose={() => setErrorsLog(null)} onRetry={openPreview} />
    </>
  );
}
