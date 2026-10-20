import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRight,
  Building2,
  CircleCheck,
  CircleSlash,
  FolderSync,
  KeyRound,
  LayoutDashboard,
  Network,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { navItems } from "@/layouts/nav-config"
import { formatCompact, formatPercent, formatRelative } from "@/lib/format"
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
  const query = useQuery({ queryKey: queryKeys.dashboard, queryFn: async () => (await dashboardService.overview()).data })
  const data = query.data
  const segments = useMemo(() => (data ? sourceSegments(data) : []), [data])
  const shortcuts = navItems.filter((item) => item.url !== "/dashboard" && can(item.permission))
  const users = data?.users

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="hidden size-10 items-center justify-center rounded-xl border bg-card text-primary shadow-xs sm:flex">
            <LayoutDashboard className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              {greeting()}，{user?.nickname || user?.username}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date())} · 以下为平台实时运行概况
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("users:create") && (
            <Button variant="outline" render={<Link to="/users" />}>
              <UserPlus />
              添加成员
            </Button>
          )}
          {can("ldap") && (
            <Button render={<Link to="/ldap" />}>
              <FolderSync />
              目录同步
            </Button>
          )}
        </div>
      </div>

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
        <Card className="col-span-12 xl:col-span-8">
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

        <Card className="col-span-12 xl:col-span-4">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-sm">企业目录</CardTitle>
              <CardDescription className="text-xs">AD / LDAP 接入与同步状态</CardDescription>
            </div>
            {can("ldap") && (
              <Button variant="ghost" size="icon-sm" render={<Link to="/ldap" aria-label="前往目录同步" />}>
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
          </CardContent>
        </Card>

        <Card className="col-span-12 xl:col-span-8">
          <CardHeader>
            <CardTitle className="text-sm">最近同步</CardTitle>
            <CardDescription className="text-xs">最近 5 次目录同步的执行结果</CardDescription>
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !data?.recent_syncs.length ? (
              <p className="rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">暂无同步记录</p>
            ) : (
              <ul className="divide-y">
                {data.recent_syncs.map((log) => (
                  <li key={log.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <SyncStatusBadge status={log.status} />
                    <code className="font-mono text-xs">{log.domain}</code>
                    <span className="text-xs text-muted-foreground">
                      {log.trigger === "schedule" ? "定时" : "手动"} · {log.mode === "full" ? "全量" : "增量"}
                    </span>
                    <span className="ml-auto flex items-center gap-3 text-xs">
                      <span>
                        新增 <strong className="tabular-nums">{log.report.created}</strong>
                      </span>
                      <span>
                        更新 <strong className="tabular-nums">{log.report.updated}</strong>
                      </span>
                      <span>
                        失败 <strong className={cn("tabular-nums", log.report.failed > 0 && "text-destructive")}>{log.report.failed}</strong>
                      </span>
                      <span className="text-muted-foreground">{formatRelative(log.started_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-12 xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-sm">快捷入口</CardTitle>
            <CardDescription className="text-xs">按你的角色授权展示</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {shortcuts.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无其他可访问的模块</p>
            ) : (
              shortcuts.map((item) => (
                <Link
                  key={item.url}
                  to={item.url}
                  className="group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <item.icon className="size-4 text-muted-foreground group-hover:text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{item.description}</p>
                  </div>
                  <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
    </>
  )
}
