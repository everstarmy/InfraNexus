import { useQuery } from "@tanstack/react-query"
import { Server, CheckCircle2, ShieldAlert, Cpu } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { racksService, type RackDTO } from "@/services/locations"

export function RackElevationView({ rack }: { rack: RackDTO }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["racks", "units", rack.id],
    queryFn: ({ signal }) => racksService.units(rack.id, signal),
  })

  const unitView = data?.data
  const units = unitView?.units ?? []

  const total = rack.units || units.length || 42
  const inUseCount = units.filter((u) => u.state === "in_use").length
  const reservedCount = units.filter((u) => u.state === "reserved").length
  const availableCount = total - inUseCount - reservedCount
  const usagePercent = total > 0 ? Math.round(((inUseCount + reservedCount) / total) * 100) : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Rack Overview Info Header */}
      <div className="rounded-lg border bg-card p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
          <div className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            <div>
              <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                机柜 {rack.name} ({rack.code})
                {rack.label && (
                  <Badge variant="outline" className="text-xs font-normal">
                    {rack.label}
                  </Badge>
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                总容量: {rack.units}U | 额定承重: {rack.max_load_kg} kg
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-emerald-500/20 border border-emerald-500/40" />
              <span>空闲 ({availableCount})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-sky-500/30 border border-sky-500/60" />
              <span>预留 ({reservedCount})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-primary border border-primary" />
              <span>在用 ({inUseCount})</span>
            </div>
            <span className="font-semibold font-mono text-primary pl-2">
              使用率: {usagePercent}%
            </span>
          </div>
        </div>

        {/* Rack Elevation Cabinet Frame */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
            加载机柜 U 位视图失败
          </div>
        ) : (
          <div className="max-w-md mx-auto rounded-lg border-2 border-border/80 bg-zinc-950 p-3 shadow-md">
            {/* Rack Mounting Post Header */}
            <div className="flex items-center justify-between px-3 py-1 mb-2 border-b border-zinc-800 text-[10px] text-zinc-400 font-mono font-semibold uppercase">
              <span>Post L</span>
              <span className="tracking-widest">FRONT ELEVATION ({total}U)</span>
              <span>Post R</span>
            </div>

            {/* Units Stack (Numbered from top down, e.g. 42 down to 1) */}
            <div className="space-y-1">
              {Array.from({ length: total }, (_, i) => {
                const uNum = total - i
                const unitData = units.find((u) => u.unit === uNum)
                const state = unitData?.state ?? (unitData?.available === false ? "in_use" : "free")

                return (
                  <div
                    key={uNum}
                    className={`flex items-center gap-2 h-7 px-2 rounded-xs border text-[11px] font-mono transition-colors ${
                      state === "in_use"
                        ? "bg-zinc-800 border-zinc-700 text-zinc-100 shadow-inner"
                        : state === "reserved"
                        ? "bg-sky-950/60 border-sky-700/60 text-sky-200"
                        : "bg-zinc-900/40 border-zinc-800/80 text-zinc-500 hover:border-zinc-700"
                    }`}
                  >
                    <span className="w-6 shrink-0 text-right text-[10px] font-bold text-zinc-400 select-none">
                      {uNum}U
                    </span>

                    <div className="flex-1 flex items-center justify-between truncate px-2">
                      {state === "in_use" ? (
                        <span className="flex items-center gap-1.5 truncate text-zinc-200">
                          <Cpu className="size-3 text-emerald-400 shrink-0" />
                          <span className="truncate">
                            设备占用 {unitData?.subject_id ? `(${unitData.subject_id.slice(0, 8)})` : ""}
                          </span>
                        </span>
                      ) : state === "reserved" ? (
                        <span className="flex items-center gap-1.5 text-sky-300">
                          <span className="size-1.5 rounded-full bg-sky-400" />
                          预留位
                        </span>
                      ) : (
                        <span className="text-zinc-600 text-[10px] select-none">空闲可用空间</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
