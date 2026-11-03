import { useMemo, type ReactNode } from "react"
import {
  Building2,
  Eye,
  History,
  LogIn,
  MoreHorizontal,
  Network,
  Pencil,
  Plug,
  Trash2,
} from "lucide-react"
import { DataTable, type ColumnDef } from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { LDAPConfig, LDAPTestResult } from "@/services/ldap"
import type { StudioTab } from "./ldap-config-sheet"
import { SyncStatusBadge } from "./sync-status"

const strategyLabels = {
  ou: "OU 自动建树",
  attribute: "按部门属性",
  none: "不同步部门",
} as const

interface Props {
  configs: LDAPConfig[]
  loading?: boolean
  can: (permission: string) => boolean
  testing: string | null
  togglingStatusIds?: ReadonlySet<string>
  selectedId: string | null
  probeResults?: Record<string, LDAPTestResult>
  onDetails: (config: LDAPConfig) => void
  onToggleStatus: (config: LDAPConfig, enabled: boolean) => void
  onEdit: (config: LDAPConfig, tab?: StudioTab) => void
  onTest: (config: LDAPConfig) => void
  onPreview: (config: LDAPConfig) => void
  onLogs: (config: LDAPConfig) => void
  onRemove: (config: LDAPConfig) => void
  onRefresh: () => void
  refreshing: boolean
  actions?: ReactNode
}

export function LdapConfigTable({
  configs,
  loading = false,
  can,
  testing,
  togglingStatusIds,
  selectedId,
  probeResults = {},
  onDetails,
  onToggleStatus,
  onEdit,
  onTest,
  onPreview,
  onLogs,
  onRemove,
  onRefresh,
  refreshing,
  actions,
}: Props) {
  const columns = useMemo<ColumnDef<LDAPConfig>[]>(
    () => [
      {
        id: "identity",
        accessorFn: (cfg) => `${cfg.name} ${cfg.domain} ${cfg.server_host}`,
        size: 250,
        minSize: 200,
        header: ({ column }) => <DataTableColumnHeader column={column} title="目录名称 / 域" />,
        cell: ({ row }) => {
          const cfg = row.original
          const isSelected = selectedId === cfg.id
          const probe = probeResults[cfg.id]
          return (
            <div className="flex min-w-0 items-start gap-2.5">
              <div
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                  cfg.type === "ad"
                    ? "bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-300"
                    : "bg-violet-500/10 text-violet-600 ring-violet-500/20 dark:text-violet-300",
                )}
              >
                {cfg.type === "ad" ? (
                  <Building2 className="size-4" />
                ) : (
                  <Network className="size-4" />
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto justify-start p-0 text-sm/5.5 font-medium"
                  onClick={() => onDetails(cfg)}
                  aria-expanded={isSelected}
                >
                  {cfg.name}
                </Button>
                <code className="text-(length:--text-description)/5 text-muted-foreground">{cfg.domain}</code>
                {probe && (
                  <span
                    className={cn(
                      "text-xs/4.5",
                      probe.success ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                    )}
                  >
                    {probe.success ? `连通 ${probe.latency_ms} ms` : "连接测试失败"}
                  </span>
                )}
                <span className="text-(length:--text-description)/5 text-muted-foreground sm:hidden">
                  {cfg.enabled ? "允许域登录" : "域登录已关闭"}
                </span>
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "type",
        header: "目录类型",
        size: 140,
        cell: ({ row }) => (
          <Badge variant="secondary">
            {row.original.type === "ad" ? "Active Directory" : "OpenLDAP"}
          </Badge>
        ),
      },
      {
        id: "login",
        accessorFn: (cfg) => (cfg.enabled ? "enabled" : "disabled"),
        header: "域账号登录",
        size: 160,
        cell: ({ row }) => {
          const cfg = row.original
          const canToggle = can("api:PATCH:/api/v1/ldap/configs/:id/status")
          const isPending = togglingStatusIds?.has(cfg.id) ?? false
          return (
            <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={cfg.enabled}
                disabled={!canToggle || isPending}
                title={!canToggle ? "需要“变更域登录状态”权限" : undefined}
                onCheckedChange={(checked) => onToggleStatus(cfg, checked)}
                aria-label={`切换 ${cfg.domain} 的域账号登录`}
              />
            </div>
          )
        },
      },
      {
        id: "server",
        accessorFn: (cfg) => `${cfg.server_host}:${cfg.port}`,
        header: "目录服务器",
        size: 210,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 text-(length:--text-description)/5">
            <code className="font-mono">
              {row.original.server_host}:{row.original.port}
            </code>
            <span className="text-muted-foreground">
              {row.original.use_ssl ? "LDAPS" : row.original.start_tls ? "StartTLS" : "明文 LDAP"}
              {row.original.insecure_skip_verify ? " · 跳过证书校验" : ""}
            </span>
          </div>
        ),
      },
      {
        id: "mapping",
        accessorFn: (cfg) => cfg.department_sync.strategy,
        header: "组织与字段映射",
        size: 190,
        cell: ({ row }) => {
          const cfg = row.original
          return (
            <div className="flex flex-col gap-1 text-(length:--text-description)/5">
              <span>{strategyLabels[cfg.department_sync.strategy] ?? "不同步部门"}</span>
              <span className="font-mono text-xs/4.5 text-muted-foreground">
                {cfg.attribute_mapping.username} / {cfg.attribute_mapping.email}
              </span>
            </div>
          )
        },
      },
      {
        id: "schedule",
        accessorFn: (cfg) => (cfg.sync_enabled ? "scheduled" : "manual"),
        header: "同步策略",
        size: 160,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 text-(length:--text-description)/5">
            <span>
              {row.original.sync_enabled
                ? `每 ${row.original.sync_interval_minutes} 分钟`
                : "仅手动同步"}
            </span>
            <span className="text-muted-foreground">
              {row.original.disable_missing_users ? "停用目录缺失账号" : "保留目录缺失账号"}
            </span>
          </div>
        ),
      },
      {
        id: "sync",
        accessorKey: "sync_status",
        header: "同步状态",
        size: 140,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <SyncStatusBadge status={row.original.sync_status} />
            <span className="text-(length:--text-description)/5 text-muted-foreground">
              {formatRelative(row.original.last_sync_at)}
            </span>
          </div>
        ),
      },
      {
        id: "actions",
        header: "操作",
        size: 160,
        enableHiding: false,
        cell: ({ row }) => {
          const cfg = row.original
          return (
            <div className="flex items-center gap-1">
              {can("ldap:sync") && (
                <Button variant="ghost" size="xs" onClick={() => onPreview(cfg)}>
                  <Eye />
                  预览同步
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={`${cfg.name} 的操作`} />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => onDetails(cfg)}>
                      <Eye />
                      查看详情
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onLogs(cfg)}>
                      <History />
                      查看同步日志
                    </DropdownMenuItem>
                    {can("ldap:update") && (
                      <>
                        <DropdownMenuItem onClick={() => onEdit(cfg)}>
                          <Pencil />
                          编辑配置
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(cfg, "policy")}>
                          <LogIn />
                          配置域登录
                        </DropdownMenuItem>
                      </>
                    )}
                    {can("ldap:test") && (
                      <DropdownMenuItem disabled={testing === cfg.id} onClick={() => onTest(cfg)}>
                        <Plug />
                        {testing === cfg.id ? "测试中…" : "测试连接"}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  {can("ldap:delete") && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={cfg.sync_status === "running"}
                          onClick={() => onRemove(cfg)}
                        >
                          <Trash2 />
                          删除配置
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    [
      can,
      onDetails,
      onEdit,
      onLogs,
      onPreview,
      onRemove,
      onTest,
      onToggleStatus,
      probeResults,
      selectedId,
      testing,
      togglingStatusIds,
    ],
  )

  return (
    <DataTable
      viewport={{ mode: "max-height", maxHeight: "55svh", mobileContent: true }}
      layoutControls={{ fullscreen: true }}
      toolbarTitle={
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-medium">全部目录配置</h2>
          <Badge variant="secondary" className="font-mono">
            {configs.length}
          </Badge>
        </div>
      }
      actions={actions}
      columns={columns}
      data={configs}
      loading={loading}
      getRowId={(cfg) => cfg.id}
      searchKey="identity"
      searchPlaceholder="搜索目录名称、域名或服务器…"
      facetedFilters={[
        {
          columnId: "type",
          title: "目录类型",
          options: [
            { label: "Active Directory", value: "ad" },
            { label: "OpenLDAP", value: "ldap" },
          ],
        },
        {
          columnId: "login",
          title: "域登录",
          options: [
            { label: "允许登录", value: "enabled" },
            { label: "禁止登录", value: "disabled" },
          ],
        },
      ]}
      columnLabels={{
        identity: "目录名称 / 域",
        type: "目录类型",
        login: "域账号登录",
        server: "目录服务器",
        mapping: "组织与字段映射",
        schedule: "同步策略",
        sync: "同步状态",
      }}
      rowClassName={(cfg) => (cfg.id === selectedId ? "bg-muted/50" : undefined)}
      onRefresh={onRefresh}
      isRefreshing={refreshing}
      emptyTitle={configs.length === 0 ? "暂无目录配置" : "没有匹配的目录"}
      emptyDescription={
        configs.length === 0
          ? "点击右上角「新建目录配置」接入 Active Directory 或 OpenLDAP 身份源"
          : "请调整搜索词或筛选条件"
      }
    />
  )
}
