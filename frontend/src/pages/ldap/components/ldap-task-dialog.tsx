import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  Copy,
  Eye,
  FileWarning,
  FolderPlus,
  Hand,
  Timer,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/common/query-error-state";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ldapService,
  type LDAPConfig,
  type SyncLog,
  type SyncMode,
} from "@/services/ldap";
import { useAuth } from "@/stores/auth-context";
import { SyncStatusBadge } from "./sync-status";

const PHASES: Array<{ key: SyncLog["phase"]; label: string }> = [
  { key: "preparing", label: "连接与准备" },
  { key: "planning", label: "校验变更计划" },
  { key: "applying", label: "批量写入变更" },
  { key: "finalizing", label: "组织树与收尾" },
];

export function LdapTaskDialog({
  log: errorsLog,
  configs,
  canReadPlanItems,
  onClose,
  onRetry,
}: {
  log: SyncLog | null;
  configs: LDAPConfig[];
  canReadPlanItems: boolean;
  onClose: () => void;
  onRetry: (config: LDAPConfig, mode: SyncMode) => void;
}) {
  const { can } = useAuth();
  const [errorFilter, setErrorFilter] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const logDetailQuery = useQuery({
    queryKey: ["ldap", "sync-log", errorsLog?.id],
    queryFn: async ({ signal }) =>
      (await ldapService.syncLog(errorsLog!.id, signal)).data,
    enabled: !!errorsLog,
    refetchInterval: errorsLog?.status === "running" ? 1500 : false,
    retry: false,
  });

  const detailedLog = logDetailQuery.data;

  const filteredTaskErrors = useMemo(() => {
    const errors = detailedLog?.report.errors ?? [];
    const keyword = errorFilter.trim().toLocaleLowerCase();
    if (!keyword) return errors;
    return errors.filter((item) =>
      `${item.username} ${item.dn} ${item.reason}`
        .toLocaleLowerCase()
        .includes(keyword),
    );
  }, [detailedLog?.report.errors, errorFilter]);

  const copyDN = async (dn: string, index: number) => {
    try {
      await navigator.clipboard.writeText(dn);
      setCopiedIndex(index);
      window.setTimeout(() => {
        setCopiedIndex((prev) => (prev === index ? null : prev));
      }, 1500);
    } catch {
      // Ignore clipboard failure in restricted contexts
    }
  };

  const activePhaseIdx = detailedLog
    ? PHASES.findIndex((p) => p.key === detailedLog.phase)
    : -1;

  return (
    <Dialog open={!!errorsLog} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88svh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-lg/6.5 font-semibold">
              <span>同步任务 · {detailedLog?.domain ?? errorsLog?.domain}</span>
              {(detailedLog ?? errorsLog) && (
                <SyncStatusBadge
                  status={(detailedLog ?? errorsLog)!.status}
                />
              )}
            </DialogTitle>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-(length:--text-description)/5">
            <span>
              {detailedLog
                ? `${formatDateTime(detailedLog.started_at, "yyyy-MM-dd HH:mm:ss")} · ${detailedLog.phase}`
                : errorsLog
                  ? formatDateTime(errorsLog.started_at, "yyyy-MM-dd HH:mm:ss")
                  : ""}
            </span>
            {detailedLog && (
              <>
                <span className="inline-flex items-center gap-1">
                  {detailedLog.trigger === "schedule" ? (
                    <CalendarClock className="size-3.5" />
                  ) : (
                    <Hand className="size-3.5" />
                  )}
                  {detailedLog.trigger === "schedule" ? "定时调度" : "手动触发"} ·{" "}
                  {detailedLog.mode === "full" ? "全量同步" : "增量同步"}
                </span>
                {detailedLog.finished_at && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Timer className="size-3.5" />
                    耗时 {(detailedLog.duration_ms / 1000).toFixed(1)} s
                  </span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {logDetailQuery.isError ? (
            <QueryErrorState
              error={logDetailQuery.error}
              label="同步任务详情"
              onRetry={() => void logDetailQuery.refetch()}
              retrying={logDetailQuery.isFetching}
            />
          ) : logDetailQuery.isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-28 rounded-xl" />
            </div>
          ) : (
            detailedLog && (
              <>
                {detailedLog.status === "running" && (
                  <div
                    className="space-y-2.5 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3.5 text-(length:--text-description)/5"
                    role="status"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-medium text-foreground">
                      <span>
                        已恢复任务快照：
                        {detailedLog.total === null
                          ? "正在计算计划规模"
                          : `已处理 ${detailedLog.processed} / ${detailedLog.total}`}
                      </span>
                      <span className="font-mono text-sky-700 dark:text-sky-300">
                        新增 {detailedLog.report.created} · 更新{" "}
                        {detailedLog.report.updated} · 停用{" "}
                        {detailedLog.report.disabled} · 失败{" "}
                        {detailedLog.report.failed}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {PHASES.map((phase, idx) => {
                        const isCurrent = idx === activePhaseIdx;
                        const isDone = idx < activePhaseIdx;
                        return (
                          <div
                            key={phase.key}
                            className={cn(
                              "rounded-lg border px-2.5 py-1.5 text-xs/4.5 transition-colors",
                              isCurrent
                                ? "border-sky-500/50 bg-sky-500/10 font-semibold text-sky-800 dark:text-sky-200"
                                : isDone
                                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                                  : "border-border/60 bg-background/60 text-muted-foreground",
                            )}
                          >
                            <span className="font-mono mr-1">{idx + 1}.</span>
                            {phase.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {detailedLog.message && (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-(length:--text-description)/5 text-destructive">
                    {detailedLog.message}
                  </p>
                )}

                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {[
                      {
                        label: "共处理",
                        value: detailedLog.report.total,
                        tone: "text-foreground",
                      },
                      {
                        label: "新增账号",
                        value: detailedLog.report.created,
                        tone:
                          detailedLog.report.created > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground",
                      },
                      {
                        label: "更新资料",
                        value: detailedLog.report.updated,
                        tone:
                          detailedLog.report.updated > 0
                            ? "text-sky-600 dark:text-sky-400"
                            : "text-muted-foreground",
                      },
                      {
                        label: "保持不变",
                        value: detailedLog.report.unchanged,
                        tone: "text-muted-foreground",
                      },
                      {
                        label: "停用回收",
                        value: detailedLog.report.disabled,
                        tone:
                          detailedLog.report.disabled > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground",
                      },
                      {
                        label: "异常失败",
                        value: detailedLog.report.failed,
                        tone:
                          detailedLog.report.failed > 0
                            ? "text-destructive"
                            : "text-muted-foreground",
                      },
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                      >
                        <p className="text-xs/4.5 text-muted-foreground">
                          {metric.label}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-xl font-semibold tabular-nums",
                            metric.tone,
                          )}
                        >
                          {metric.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--text-description)/5 text-muted-foreground">
                    <p>
                      共处理 {detailedLog.report.total} 条 · 新增{" "}
                      {detailedLog.report.created} · 更新{" "}
                      {detailedLog.report.updated} · 不变{" "}
                      {detailedLog.report.unchanged} · 停用{" "}
                      {detailedLog.report.disabled} · 跳过{" "}
                      {detailedLog.report.skipped} · 失败{" "}
                      {detailedLog.report.failed}
                    </p>
                    {detailedLog.report.departments_created > 0 && (
                      <Badge variant="secondary" className="gap-1">
                        <FolderPlus className="size-3" />
                        新建部门 {detailedLog.report.departments_created}
                      </Badge>
                    )}
                  </div>
                </div>

                {(detailedLog.status === "partial" ||
                  detailedLog.status === "failed") &&
                  can("ldap:sync") &&
                  canReadPlanItems && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5">
                      <p className="text-(length:--text-description)/5 text-muted-foreground">
                        修复目录或映射冲突后，可重新生成预览计划并再次执行同步。
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        title="重新读取目录与本地版本生成新计划；核对计划后再执行，不会重放旧写入。"
                        onClick={() => {
                          const cfg = configs.find(
                            (item) => item.id === detailedLog.config_id,
                          );
                          if (!cfg) return;
                          onClose();
                          onRetry(cfg, detailedLog.mode);
                        }}
                      >
                        <Eye />
                        重新预览并重试
                      </Button>
                    </div>
                  )}

                {(detailedLog.report.errors?.length ?? 0) > 0 && (
                  <div className="space-y-2.5 pt-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-(length:--text-description)/5 font-semibold text-foreground">
                        <FileWarning className="size-3.5 text-destructive" />
                        <span>
                          失败与冲突诊断明细 ({detailedLog.report.errors?.length ?? 0})
                        </span>
                      </div>
                      {detailedLog.report.errors_truncated && (
                        <span className="text-xs/4.5 text-muted-foreground">
                          诊断明细仅保留前 200 条；失败总数按完整计划统计。
                        </span>
                      )}
                    </div>
                    <Input
                      aria-label="筛选失败明细"
                      placeholder="按账号、DN 或错误原因筛选"
                      value={errorFilter}
                      onChange={(event) => setErrorFilter(event.target.value)}
                    />
                    <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {filteredTaskErrors.map((e, i) => (
                        <li
                          key={i}
                          className="rounded-xl border border-border/80 bg-card px-3.5 py-2.5 shadow-2xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-mono text-(length:--text-description)/5 font-semibold text-foreground">
                              {e.username || "（无用户名）"}
                            </p>
                            {e.dn && (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="h-6 px-1.5 text-xs/4.5 text-muted-foreground"
                                onClick={() => void copyDN(e.dn, i)}
                              >
                                {copiedIndex === i ? (
                                  <>
                                    <Check className="size-3 text-emerald-600" />
                                    已复制
                                  </>
                                ) : (
                                  <>
                                    <Copy className="size-3" />
                                    复制 DN
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                          <p
                            className="mt-0.5 truncate font-mono text-xs/4.5 text-muted-foreground"
                            title={e.dn}
                          >
                            {e.dn || "—"}
                          </p>
                          <p className="mt-1.5 rounded-md bg-destructive/5 px-2 py-1 text-(length:--text-description)/5 text-destructive">
                            {e.reason}
                          </p>
                        </li>
                      ))}
                      {filteredTaskErrors.length === 0 && (
                        <li className="py-6 text-center text-(length:--text-description)/5 text-muted-foreground">
                          没有匹配的失败明细
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
