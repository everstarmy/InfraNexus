import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { cn } from "@/lib/utils"
import { locationsService, type LocationNode, type RackExt, type RackUnit } from "@/services/locations"

interface RackElevationViewProps {
  rack: LocationNode
  onEditSecurityZone?: () => void
}

const statusConfig: Record<
  string,
  { label: string; tone: "success" | "primary" | "warning" | "destructive" | "default"; bg: string; border: string; text: string }
> = {
  available: {
    label: "空闲",
    tone: "success",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  in_use: {
    label: "在用",
    tone: "primary",
    bg: "bg-blue-500/15",
    border: "border-blue-500/40",
    text: "text-blue-700 dark:text-blue-300 font-medium",
  },
  reserved: {
    label: "预留",
    tone: "warning",
    bg: "bg-amber-500/15",
    border: "border-amber-500/40",
    text: "text-amber-700 dark:text-amber-400 font-medium",
  },
  unavailable: {
    label: "不可用",
    tone: "destructive",
    bg: "bg-muted/60",
    border: "border-border",
    text: "text-muted-foreground",
  },
}

function getUnitStatus(unit: RackUnit): string {
  if (unit.available) return "available"
  if (unit.state === "in_use") return "in_use"
  if (unit.state === "reserved") return "reserved"
  return "unavailable"
}

export function RackElevationView({ rack, onEditSecurityZone }: RackElevationViewProps) {
  const [filterState, setFilterState] = useState<string>("all")
  const ext = (rack.ext ?? {}) as RackExt
  const heightU = Number(ext.height_u ?? 42)

  const unitsQuery = useQuery({
    queryKey: ["location-nodes", "units", rack.uid],
    queryFn: ({ signal }) => locationsService.units(rack.uid, signal),
  })

  const units = useMemo(() => {
    const list = unitsQuery.data?.data?.units ?? []
    // Make sure all units 1 to heightU exist or are mapped
    const map = new Map<number, RackUnit>()
    for (const u of list) {
      map.set(u.unit, u)
    }
    const fullList: RackUnit[] = []
    for (let u = heightU; u >= 1; u--) {
      const existing = map.get(u)
      if (existing) {
        fullList.push(existing)
      } else {
        fullList.push({ unit: u, available: true, state: "available" })
      }
    }
    return fullList
  }, [unitsQuery.data, heightU])

  const stats = useMemo(() => {
    let inUse = 0
    let reserved = 0
    let available = 0
    let unavailable = 0

    for (const u of units) {
      const status = getUnitStatus(u)
      if (status === "in_use") inUse++
      else if (status === "reserved") reserved++
      else if (status === "available") available++
      else unavailable++
    }

    const usagePercent = heightU > 0 ? Math.round((inUse / heightU) * 100) : 0
    return { inUse, reserved, available, unavailable, usagePercent }
  }, [units, heightU])

  const filteredUnits = useMemo(() => {
    if (filterState === "all") return units
    return units.filter((u) => getUnitStatus(u) === filterState)
  }, [units, filterState])

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
      {/* Rack summary stats */}
      <StatGrid>
        <StatCard
          label="总高度"
          value={`${heightU} U`}
          icon={Layers}
          tone="default"
          loading={unitsQuery.isLoading}
          hint={`行 ${ext.row} · 列 ${ext.column}`}
        />
        <StatCard
          label="已占用"
          value={`${stats.inUse} U`}
          icon={Server}
          tone="primary"
          loading={unitsQuery.isLoading}
          hint={`使用率 ${stats.usagePercent}%`}
        />
        <StatCard
          label="预留中"
          value={`${stats.reserved} U`}
          icon={Clock}
          tone="warning"
          loading={unitsQuery.isLoading}
        />
        <StatCard
          label="空闲可用"
          value={`${stats.available} U`}
          icon={CheckCircle2}
          tone="success"
          loading={unitsQuery.isLoading}
          hint={ext.power_capacity_w ? `承载功率 ${ext.power_capacity_w}W (${(ext.power_capacity_w / 1000).toFixed(1)}kW)` : undefined}
        />
      </StatGrid>

      {/* Rack U Visualization Frame */}
      <Card size="sm" className="rounded-xl border border-border/80 bg-card py-0 ring-0 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">机柜 U 位立面图 (Elevation)</CardTitle>
            <Badge variant="outline" className="text-xs">
              {heightU}U 标准立面
            </Badge>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setFilterState("all")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  filterState === "all" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                全部 ({units.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterState("in_use")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  filterState === "in_use" ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                在用 ({stats.inUse})
              </button>
              <button
                type="button"
                onClick={() => setFilterState("reserved")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  filterState === "reserved" ? "bg-background text-amber-600 shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                预留 ({stats.reserved})
              </button>
              <button
                type="button"
                onClick={() => setFilterState("available")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  filterState === "available" ? "bg-background text-emerald-600 shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                空闲 ({stats.available})
              </button>
            </div>

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => void unitsQuery.refetch()}
              title="刷新 U 位数据"
              aria-label="刷新 U 位数据"
            >
              <RefreshCw className={cn("size-3.5", unitsQuery.isFetching && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4">
          {unitsQuery.isPending && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>正在加载 U 位排布...</span>
            </div>
          )}

          {unitsQuery.isError && (
            <div className="py-8 text-center text-sm text-destructive">
              U 位数据加载失败
              <Button
                variant="outline"
                size="sm"
                className="mt-2 ml-2"
                onClick={() => void unitsQuery.refetch()}
              >
                重试
              </Button>
            </div>
          )}

          {!unitsQuery.isPending && !unitsQuery.isError && (
            <div className="mx-auto max-w-xl">
              {/* Rack frame top banner */}
              <div className="flex items-center justify-between rounded-t-lg border-2 border-b-0 border-border/80 bg-muted/80 px-4 py-2 font-mono text-xs font-semibold text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  <span>{rack.name}</span>
                </div>
                <span>
                  {ext.row} 排 {ext.column} 列 · {heightU}U
                </span>
              </div>

              {/* Slots list (U_max down to U_1) */}
              <div className="border-2 border-border/80 bg-background divide-y divide-border/40">
                {filteredUnits.map((u) => {
                  const statusKey = getUnitStatus(u)
                  const cfg = statusConfig[statusKey] || statusConfig.unavailable

                  return (
                    <div
                      key={u.unit}
                      className={cn(
                        "group flex items-center justify-between px-3 py-1.5 transition-colors text-xs font-mono",
                        cfg.bg,
                        "hover:opacity-90",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 shrink-0 font-bold text-muted-foreground text-right">
                          {String(u.unit).padStart(2, "0")}U
                        </span>
                        <div className="h-3 w-px bg-border/60" />
                        <span className={cn("text-xs font-sans", cfg.text)}>
                          {cfg.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 font-sans">
                        {u.subject_id && (
                          <span className="rounded bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground border">
                            设备 ID: {u.subject_id}
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={cn("h-4 px-1.5 text-[10px] uppercase", cfg.border, cfg.text)}
                        >
                          {statusKey}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Rack frame bottom base */}
              <div className="h-3 rounded-b-lg border-2 border-t-0 border-border/80 bg-muted/80" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
