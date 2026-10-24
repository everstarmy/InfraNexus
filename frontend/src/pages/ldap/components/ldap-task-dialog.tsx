import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/common/query-error-state";
import { formatDateTime } from "@/lib/format";
import {
  ldapService,
  type LDAPConfig,
  type SyncLog,
  type SyncMode,
} from "@/services/ldap";
import { useAuth } from "@/stores/auth-context";

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

  return (
    <Dialog open={!!errorsLog} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            同步任务 · {detailedLog?.domain ?? errorsLog?.domain}
          </DialogTitle>
          <DialogDescription>
            {detailedLog
              ? `${formatDateTime(detailedLog.started_at, "yyyy-MM-dd HH:mm:ss")} · ${detailedLog.phase}`
              : errorsLog
                ? formatDateTime(errorsLog.started_at, "yyyy-MM-dd HH:mm:ss")
                : ""}
          </DialogDescription>
        </DialogHeader>
        {logDetailQuery.isError ? (
          <QueryErrorState
            error={logDetailQuery.error}
            label="同步任务详情"
            onRetry={() => void logDetailQuery.refetch()}
            retrying={logDetailQuery.isFetching}
          />
        ) : logDetailQuery.isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : (
          detailedLog && (
            <>
              {detailedLog.status === "running" && (
                <div
                  className="rounded-lg border bg-muted/30 px-3 py-2 text-xs"
                  role="status"
                >
                  已恢复任务快照：
                  {detailedLog.total === null
                    ? "正在计算计划规模"
                    : `已处理 ${detailedLog.processed} / ${detailedLog.total}`}{" "}
                  · 新增 {detailedLog.report.created} · 更新{" "}
                  {detailedLog.report.updated} · 停用{" "}
                  {detailedLog.report.disabled} · 失败{" "}
                  {detailedLog.report.failed}
                </div>
              )}
              {detailedLog.message && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {detailedLog.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                共处理 {detailedLog.report.total} 条 · 新增{" "}
                {detailedLog.report.created} · 更新 {detailedLog.report.updated}{" "}
                · 不变 {detailedLog.report.unchanged} · 停用{" "}
                {detailedLog.report.disabled} · 跳过{" "}
                {detailedLog.report.skipped} · 失败 {detailedLog.report.failed}
              </p>
              {(detailedLog.status === "partial" ||
                detailedLog.status === "failed") &&
                can("ldap:sync") &&
                canReadPlanItems && (
                  <Button
                    size="sm"
                    variant="outline"
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
                )}
              {(detailedLog.report.errors?.length ?? 0) > 0 && (
                <Input
                  aria-label="筛选失败明细"
                  placeholder="按账号、DN 或错误原因筛选"
                  value={errorFilter}
                  onChange={(event) => setErrorFilter(event.target.value)}
                />
              )}
              {detailedLog.report.errors_truncated && (
                <p className="text-xs text-muted-foreground">
                  诊断明细仅保留前 200 条；失败总数按完整计划统计。
                </p>
              )}
            </>
          )
        )}
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {filteredTaskErrors.map((e, i) => (
            <li key={i} className="rounded-lg border px-3 py-2">
              <p className="font-mono text-xs font-medium">
                {e.username || "（无用户名）"}
              </p>
              <p
                className="truncate font-mono text-[11px] text-muted-foreground"
                title={e.dn}
              >
                {e.dn}
              </p>
              <p className="mt-0.5 text-xs text-destructive">{e.reason}</p>
            </li>
          ))}
          {detailedLog &&
            (detailedLog.report.errors?.length ?? 0) > 0 &&
            filteredTaskErrors.length === 0 && (
              <li className="py-6 text-center text-xs text-muted-foreground">
                没有匹配的失败明细
              </li>
            )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
