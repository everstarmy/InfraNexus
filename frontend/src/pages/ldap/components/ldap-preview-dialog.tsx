import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Equal,
  FolderPlus,
  Play,
  RefreshCw,
  SkipForward,
  TriangleAlert,
  UserPlus,
  UserX,
} from "lucide-react";
import {
  DataTable,
  type ColumnDef,
  type FacetedFilterConfig,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { QueryErrorState } from "@/components/common/query-error-state";
import { cn } from "@/lib/utils";
import {
  ldapService,
  type LDAPConfig,
  type SyncMode,
  type SyncPlan,
  type SyncPlanItem,
} from "@/services/ldap";

const actionMeta: Record<
  SyncPlanItem["action"],
  { label: string; icon: typeof UserPlus; className: string }
> = {
  create: {
    label: "新增",
    icon: UserPlus,
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  update: {
    label: "更新",
    icon: RefreshCw,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  unchanged: {
    label: "不变",
    icon: Equal,
    className: "border-border text-muted-foreground",
  },
  disable: {
    label: "停用",
    icon: UserX,
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  skip: {
    label: "跳过",
    icon: SkipForward,
    className: "border-border text-muted-foreground",
  },
  conflict: {
    label: "冲突",
    icon: TriangleAlert,
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

const changeLabels: Record<string, string> = {
  username: "用户名",
  nickname: "姓名",
  email: "邮箱",
  external_id: "目录标识",
  department: "部门",
  status: "状态",
};

export function LdapPreviewDialog({
  config,
  canRun,
  canReadDetails,
  initialMode = "full",
  onOpenChange,
  onRun,
}: {
  config: LDAPConfig | null;
  canRun: boolean;
  canReadDetails: boolean;
  initialMode?: SyncMode;
  onOpenChange: (open: boolean) => void;
  onRun: (config: LDAPConfig, mode: SyncMode, plan: SyncPlan) => void;
}) {
  const [mode, setMode] = useState<SyncMode>(initialMode);
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 50;
  useEffect(() => {
    setMode(initialMode);
    setPageIndex(0);
  }, [initialMode, config?.id]);
  const query = useQuery({
    queryKey: ["ldap", "preview", config?.id, mode],
    queryFn: async ({ signal }) =>
      (await ldapService.preview(config!.id, mode, signal)).data,
    enabled: !!config,
    retry: false,
    gcTime: 0,
  });
  const plan = query.data;
  const detailsQuery = useQuery({
    queryKey: ["ldap", "plan-items", plan?.plan_id, pageIndex, pageSize],
    queryFn: async ({ signal }) =>
      (
        await ldapService.planItems(
          plan!.plan_id,
          pageIndex + 1,
          pageSize,
          signal,
        )
      ).data,
    enabled: !!plan?.plan_id,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<SyncPlanItem>[]>(
    () => [
      {
        id: "action",
        accessorKey: "action",
        header: "动作",
        cell: ({ row }) => {
          const m = actionMeta[row.original.action];
          const Icon = m.icon;
          return (
            <Badge variant="outline" className={cn("gap-1", m.className)}>
              <Icon />
              {m.label}
            </Badge>
          );
        },
      },
      {
        id: "username",
        accessorKey: "username",
        header: "账号",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-mono text-xs font-medium">
              {row.original.username || "（缺失）"}
            </p>
            <p
              className="max-w-52 truncate text-[11px] text-muted-foreground"
              title={row.original.dn}
            >
              {row.original.nickname || row.original.dn}
            </p>
          </div>
        ),
      },
      {
        id: "department",
        accessorKey: "department",
        header: "部门",
        cell: ({ row }) => (
          <span className="text-xs">{row.original.department || "—"}</span>
        ),
      },
      {
        id: "detail",
        accessorFn: (i) => `${(i.changes ?? []).join(",")} ${i.reason ?? ""}`,
        header: "变更 / 说明",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex max-w-72 flex-wrap items-center gap-1">
              {(item.changes ?? []).map((c) => (
                <Badge
                  key={c}
                  variant="secondary"
                  className="h-4.5 text-[10px]"
                >
                  {changeLabels[c] ?? c}
                </Badge>
              ))}
              {(item.diff ?? []).map((diff) => (
                <span
                  key={`${diff.field}-${diff.before}-${diff.after}`}
                  className="w-full text-[11px] text-muted-foreground"
                >
                  {changeLabels[diff.field] ?? diff.field}：{diff.before || "—"}{" "}
                  → {diff.after || "—"}
                </span>
              ))}
              {item.reason && (
                <span className="text-[11px] text-muted-foreground">
                  {item.reason}
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [],
  );

  const facets: FacetedFilterConfig[] = [
    {
      columnId: "action",
      title: "动作",
      options: Object.entries(actionMeta).map(([value, m]) => ({
        value,
        label: m.label,
        icon: m.icon,
        count: plan
          ? plan.summary[
              {
                create: "create",
                update: "update",
                unchanged: "unchanged",
                disable: "disable",
                skip: "skip",
                conflict: "conflict",
              }[value] as keyof typeof plan.summary
            ]
          : undefined,
      })),
    },
  ];

  const tiles = plan
    ? [
        { key: "create", value: plan.summary.create },
        { key: "update", value: plan.summary.update },
        { key: "unchanged", value: plan.summary.unchanged },
        { key: "disable", value: plan.summary.disable },
        { key: "skip", value: plan.summary.skip },
        { key: "conflict", value: plan.summary.conflict },
      ]
    : [];

  return (
    <Dialog open={!!config} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b p-5 pr-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <DialogTitle>同步预览 · {config?.name}</DialogTitle>
              <DialogDescription>
                只读演算本次同步将产生的变更，不会写入任何数据
              </DialogDescription>
            </div>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[mode]}
              onValueChange={(v) => {
                if (v[0]) {
                  setMode(v[0] as SyncMode);
                  setPageIndex(0);
                }
              }}
            >
              <ToggleGroupItem value="full">全量</ToggleGroupItem>
              <ToggleGroupItem value="incremental">增量</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {query.isError ? (
            <QueryErrorState
              error={query.error}
              label="同步预览"
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          ) : !plan ? (
            <div
              className="space-y-3"
              role="status"
              aria-label="正在生成目录同步预览"
              aria-busy="true"
            >
              <span className="sr-only">正在生成目录同步预览…</span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-64 rounded-xl" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {tiles.map((t) => {
                  const m = actionMeta[t.key as SyncPlanItem["action"]];
                  const Icon = m.icon;
                  return (
                    <div
                      key={t.key}
                      className="rounded-xl border bg-card px-3 py-2.5"
                    >
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Icon className="size-3.5" />
                        {m.label}
                      </p>
                      <p className="mt-0.5 text-xl font-semibold">{t.value}</p>
                    </div>
                  );
                })}
              </div>
              {plan.departments_to_create.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed px-3 py-2.5">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <FolderPlus className="size-3.5" />
                    将新建部门：
                  </span>
                  {plan.departments_to_create.map((d) => (
                    <Badge key={d} variant="secondary">
                      {d}
                    </Badge>
                  ))}
                </div>
              )}
              {mode === "incremental" && (
                <p className="text-xs text-muted-foreground">
                  增量模式只处理上次成功同步后变更的账号，不会停用目录中缺失的账号。
                </p>
              )}
              {!canReadDetails && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  当前账号没有读取目录计划明细的权限，无法确认并执行该计划。
                </p>
              )}
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground">
                计划于 {new Date(plan.generated_at).toLocaleString()}{" "}
                生成，有效至 {new Date(plan.expires_at).toLocaleTimeString()}
                。将按本次预览数据执行；LDAP 后续变化由下一次同步处理。
                {plan.truncated &&
                  ` 影响总数 ${plan.summary.total}，明细按页读取。`}
              </div>
              {detailsQuery.isError ? (
                <QueryErrorState
                  error={detailsQuery.error}
                  label="计划明细"
                  onRetry={() => void detailsQuery.refetch()}
                  retrying={detailsQuery.isFetching}
                />
              ) : (
                <DataTable
                  columns={columns}
                  data={detailsQuery.data?.items ?? []}
                  loading={detailsQuery.isLoading}
                  getRowId={(item, index) =>
                    `${item.dn}-${item.username}-${index}`
                  }
                  facetedFilters={facets}
                  searchPlaceholder="搜索当前页账号或部门"
                  defaultPageSize={pageSize}
                  serverPagination={{
                    pageIndex,
                    pageSize,
                    total: detailsQuery.data?.total ?? plan.summary.total,
                    onChange: (next) => {
                      setPageIndex(next.pageIndex);
                    },
                  }}
                  emptyTitle="目录中没有匹配的账号"
                  emptyDescription="请检查 Base DN 与用户过滤器配置"
                />
              )}
            </>
          )}
        </div>
        <DialogFooter className="m-0 rounded-b-xl border-t bg-muted/40 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {canRun && (
            <Button
              onClick={() => config && plan && onRun(config, mode, plan)}
              disabled={
                !plan ||
                query.isError ||
                query.isFetching ||
                detailsQuery.isError ||
                !canReadDetails
              }
            >
              <Play />
              按此计划执行{mode === "full" ? "全量" : "增量"}同步
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
