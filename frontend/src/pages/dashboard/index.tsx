import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRight,
  Building2,
  CircleCheck,
  CircleSlash,
  KeyRound,
  LayoutDashboard,
  Network,
  ShieldCheck,
  UserPlus,
  Users,
  Waypoints,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { QueryErrorState, isForbiddenQueryError } from "@/components/common/query-error-state"
import { pageNavItems } from "@/layouts/nav-config"
import { formatCompact, formatDateTime, formatPercent, formatRelative } from "@/lib/format"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { dashboardService, type DashboardOverview } from "@/services/dashboard"
import { SyncStatusBadge } from "@/pages/ldap/components/sync-status"
import { useAuth } from "@/stores/auth-context"

interface Segment {
  key: string
  label: string
  count: number
  color: string
}

const SERIES = ["var(--viz-series-1)", "var(--viz-series-2)", "var(--viz-series-3)", "var(--viz-series-4)"]

function sourceSegments(overview: DashboardOverview): Segment[] {
  const domains = [...overview.users.by_domain].sort((a, b) => a.domain.localeCompare(b.domain))
  const shown = domains.length > 3 ? domains.slice(0, 2) : domains
  const rest = domains.length > 3 ? domains.slice(2) : []
  const segments: Segment[] = [{ key: "local", label: "本地账号", count: overview.users.local, color: SERIES[0] }]
  shown.forEach((d, i) => segments.push({ key: d.domain, label: `${d.domain}（${d.auth_type === "ad" ? "AD" : "LDAP"}）`, count: d.count, color: SERIES[i + 1] }))
  if (rest.length > 0) {
    segments.push({ key: "other", label: `其他 ${rest.length} 个域`, count: rest.reduce((s, d) => s + d.count, 0), color: "var(--viz-other)" })
  }
  return segments
}

function StackedBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((s, x) => s + x.count, 0)
  const visible = segments.filter((s) => s.count > 0)
  return (
    <div role="img" aria-label={`${label}：${visible.map((s) => `${s.label} ${s.count}`).join("，")}`} className="flex h-3.5 w-full gap-0.5">
      {total === 0 ? (
        <div className="h-full w-full rounded bg-muted" />
      ) : (
        visible.map((s, i) => (
          <Tooltip key={s.key}>
            <TooltipTrigger
              render={
                <div
                  className={cn("h-full min-w-1.5 transition-[filter] hover:brightness-110", i === 0 && "rounded-l", i === visible.length - 1 && "rounded-r")}
                  style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
                />
              }
            />
            <TooltipContent>
              {s.label} · {s.count} 人（{formatPercent(s.count, total)}）
            </TooltipContent>
          </Tooltip>
        ))
      )}
    </div>
  )
}

function Legend({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.count, 0)
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">账号来源明细</caption>
      <tbody>
        {segments.map((s) => (
          <tr key={s.key} className="border-b border-border/60 last:border-0">
            <td className="py-2">
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="truncate">{s.label}</span>
              </span>
            </td>
            <td className="py-2 text-right font-medium tabular-nums">{s.count}</td>
            <td className="w-16 py-2 text-right text-muted-foreground tabular-nums">{formatPercent(s.count, total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 6) return "夜深了"
  if (hour < 12) return "早上好"
  if (hour < 14) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
}

export default function DashboardPage() {
  const { user, can } = useAuth()
  const query = useQuery({ queryKey: queryKeys.dashboard, queryFn: async ({ signal }) => (await dashboardService.overview(signal)).data })
  const data = query.data
  const segments = useMemo(() => (data ? sourceSegments(data) : []), [data])
  const shortcuts = pageNavItems.filter((item) => item.url !== "/dashboard" && can(item.permission))
  const users = data?.users
  const overviewForbidden = isForbiddenQueryError(query.error)
  const overviewUnavailable = query.isError && (!data || overviewForbidden)
  const dashboardStatus = query.isError ? "数据更新失败" : query.isFetching ? "正在刷新数据" : data ? "数据已加载" : "正在加载数据"

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="hidden size-11 items-center justify-center rounded-xl border border-border/80 bg-gradient-to-b from-card to-muted/40 text-primary shadow-xs ring-1 ring-primary/10 sm:flex">
            <LayoutDashboard className="size-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                {greeting()}，{user?.nickname || user?.username}
              </h1>
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                query.isError ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              )} role="status" aria-live="polite">
                <span className={cn("size-1.5 rounded-full", query.isError ? "bg-amber-500" : "bg-emerald-500", !query.isError && "motion-safe:animate-pulse")} />
                {dashboardStatus}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date())} · {data ? `数据更新于 ${formatDateTime(new Date(query.dataUpdatedAt).toISOString(), "yyyy-MM-dd HH:mm:ss")}` : "等待工作台数据"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("users:create") && (
            <Button variant="outline" nativeButton={false} render={<Link to="/users?create=1" />}>
              <UserPlus />
              添加成员
            </Button>
          )}
          {can("ldap") && (
            <Button nativeButton={false} render={<Link to="/ldap" />}>
              <Waypoints />
              身份源集成
            </Button>
          )}
        </div>
      </div>

      {query.isError && data && !overviewForbidden && (
        <QueryErrorState error={query.error} label="工作台数据" onRetry={() => void query.refetch()} retrying={query.isFetching} />
      )}
      {overviewUnavailable ? (
        <QueryErrorState error={query.error} label="工作台数据" onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : <>
      <StatGrid>
        <StatCard label="用户总数" value={formatCompact(users?.total ?? 0)} icon={Users} tone="primary" loading={query.isLoading} hint={users ? `启用 ${users.active} · 停用 ${users.disabled}` : undefined} />
        <StatCard label="组织部门" value={formatCompact(data?.departments.total ?? 0)} icon={Network} tone="info" loading={query.isLoading} hint={data ? `目录同步 ${data.departments.from_directory} · 停用 ${data.departments.disabled}` : undefined} />
        <StatCard label="角色" value={data?.roles.total ?? 0} icon={ShieldCheck} tone="violet" loading={query.isLoading} hint={data ? `内置 ${data.roles.built_in} · 自定义 ${data.roles.total - data.roles.built_in}` : undefined} />
        <StatCard
          label="权限点"
          value={data ? data.permissions.menus + data.permissions.buttons + data.permissions.apis : 0}
          icon={KeyRound}
          tone="warning"
          loading={query.isLoading}
          hint={data ? `菜单 ${data.permissions.menus} · 按钮 ${data.permissions.buttons} · 接口 ${data.permissions.apis}` : undefined}
        />
      </StatGrid>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 xl:col-span-8 border border-border/80 bg-card shadow-xs rounded-xl">
          <CardHeader>
            <CardTitle className="text-sm">账号构成</CardTitle>
            <CardDescription className="text-xs">按认证来源与账号状态拆分的人员分布</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {query.isLoading || !users ? (
              <div className="space-y-3">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : (
              <>
                <section className="space-y-3">
                  <h3 className="text-xs font-medium text-muted-foreground">认证来源</h3>
                  <StackedBar segments={segments} label="认证来源" />
                  <Legend segments={segments} />
                </section>
                <section className="space-y-3">
                  <h3 className="text-xs font-medium text-muted-foreground">账号状态</h3>
                  <StackedBar
                    label="账号状态"
                    segments={[
                      { key: "active", label: "启用", count: users.active, color: "var(--viz-good)" },
                      { key: "disabled", label: "停用", count: users.disabled, color: "var(--viz-other)" },
                    ]}
                  />
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span className="flex items-center gap-1.5">
                      <CircleCheck className="size-4" style={{ color: "var(--viz-good)" }} />
                      启用 <strong className="font-medium tabular-nums">{users.active}</strong>
                      <span className="text-muted-foreground">（{formatPercent(users.active, users.total)}）</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CircleSlash className="size-4" style={{ color: "var(--viz-other)" }} />
                      停用 <strong className="font-medium tabular-nums">{users.disabled}</strong>
                      <span className="text-muted-foreground">（{formatPercent(users.disabled, users.total)}）</span>
                    </span>
                    <span className="text-muted-foreground">未分配部门 {users.unassigned} 人</span>
                  </div>
                </section>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-12 xl:col-span-4 border border-border/80 bg-card shadow-xs rounded-xl">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-sm">企业目录</CardTitle>
              <CardDescription className="text-xs">AD / LDAP 接入与同步状态</CardDescription>
            </div>
            {can("ldap") && (
              <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/ldap" aria-label="前往身份源集成" />}>
                <ArrowUpRight />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !data?.directories.length ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
                <Building2 className="size-6" />
                尚未接入企业目录
              </div>
            ) : (
              <ul className="space-y-2">
                {data.directories.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
                      {d.type === "ad" ? <Building2 className="size-4" /> : <Network className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {d.domain} · {formatRelative(d.last_sync_at)}
                      </p>
                    </div>
                    <SyncStatusBadge status={d.sync_status} />
                  </li>
                ))}
              </ul>
            )}
            {!!data?.recent_syncs.length && (
              <div className="mt-5 space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">最近同步</h3>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {data.recent_syncs.slice(0, 4).map((log) => (
                    <li key={log.id} className="relative">
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-card",
                          log.status === "success" ? "bg-emerald-500" : log.status === "partial" ? "bg-amber-500" : log.status === "failed" ? "bg-rose-500" : "bg-sky-500",
                        )}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <code className="truncate font-mono text-xs">{log.domain}</code>
                        <SyncStatusBadge status={log.status} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {log.trigger === "schedule" ? "定时" : "手动"}{log.mode === "full" ? "全量" : "增量"} · 新增 {log.report.created} · 更新 {log.report.updated} · 失败 {log.report.failed} · {formatRelative(log.started_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-12">
          <CardHeader>
            <CardTitle className="text-sm">快捷入口</CardTitle>
            <CardDescription className="text-xs">按你的角色授权展示可访问的模块</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {shortcuts.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无其他可访问的模块</p>
            ) : (
              shortcuts.map((item) => (
                <Link
                  key={item.url}
                  to={item.url}
                  className="group flex items-start gap-3 rounded-xl border bg-card px-3.5 py-3 transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-primary/30 hover:bg-primary/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <item.icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-sm font-medium">
                      {item.title}
                      <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{item.description}</p>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      {data && (
        <p className="text-center text-[11px] text-muted-foreground">
          数据实时汇总自平台数据库 · <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{formatCompact(data.users.total)} 名成员</Badge>
        </p>
      )}
      </>}
    </>
  )
}
