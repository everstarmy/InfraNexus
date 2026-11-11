import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { securityZonesService } from "@/services/ipam"
import { locationsService, type LocationNode } from "@/services/locations"

interface LocationSecurityZoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rack: LocationNode | null
  onSuccess?: (saved: LocationNode) => void
}

export function LocationSecurityZoneDialog({
  open,
  onOpenChange,
  rack,
  onSuccess,
}: LocationSecurityZoneDialogProps) {
  const queryClient = useQueryClient()
  const [selectedZoneId, setSelectedZoneId] = useState<string>("")
  const [error, setError] = useState("")

  const datacenter = rack?.path?.find((p) => p.type === "datacenter")

  useEffect(() => {
    if (open && rack) {
      setSelectedZoneId(rack.security_zone_id ?? "")
      setError("")
    }
  }, [open, rack])

  const zonesQuery = useQuery({
    queryKey: ["ipam", "security-zones", "for-dc", datacenter?.uid],
    enabled: open && Boolean(datacenter?.uid),
    queryFn: async ({ signal }) => {
      const res = await securityZonesService.list(
        { parent_id: datacenter?.uid, page: 1, page_size: 100, status: 1 },
        signal,
      )
      return res.data.items
    },
  })

  const mutation = useMutation({
    mutationFn: async () => {
      if (!rack) throw new Error("未选择机柜")
      const zonePayload = selectedZoneId ? selectedZoneId : null
      const res = await locationsService.securityZone(rack.uid, rack.version, zonePayload)
      return res.data
    },
    onSuccess: (updated) => {
      notify.success("机柜安全域设置已更新")
      void queryClient.invalidateQueries({ queryKey: ["location-nodes"] })
      onSuccess?.(updated)
      onOpenChange(false)
    },
    onError: (err) => {
      setError(getErrorMessage(err, "设置机柜安全域失败"))
    },
  })

  if (!rack) return null

  const zones = zonesQuery.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-primary" />
            <span>设置机柜安全域</span>
          </DialogTitle>
          <DialogDescription>
            为机柜「{rack.name}」绑定所属数据中心下的网络安全隔离域。
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3 text-xs">
          <div className="rounded-md border bg-muted/30 p-2.5">
            <div className="text-muted-foreground">所属数据中心：</div>
            <div className="mt-1 font-medium">{datacenter?.name ?? "未检测到关联数据中心"}</div>
          </div>

          <div className="space-y-1.5">
            <div className="font-medium text-foreground">选择安全域：</div>

            {zonesQuery.isLoading && (
              <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span>正在加载安全域列表...</span>
              </div>
            )}

            {zonesQuery.isError && (
              <div className="py-3 text-center text-destructive">
                加载安全域失败
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-2 h-6 px-1.5 text-xs"
                  onClick={() => void zonesQuery.refetch()}
                >
                  重试
                </Button>
              </div>
            )}

            {!zonesQuery.isLoading && !zonesQuery.isError && (
              <div className="space-y-1 max-h-56 overflow-y-auto rounded-md border p-1">
                <label className="flex items-center gap-2 rounded p-2 hover:bg-muted cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="security_zone"
                    checked={selectedZoneId === ""}
                    onChange={() => setSelectedZoneId("")}
                    className="size-3.5"
                  />
                  <div>
                    <div className="font-medium">无安全域</div>
                    <div className="text-[11px] text-muted-foreground">不分配专属安全域隔离规则</div>
                  </div>
                </label>

                {zones.map((zone) => (
                  <label
                    key={zone.id}
                    className="flex items-center gap-2 rounded p-2 hover:bg-muted cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name="security_zone"
                      checked={selectedZoneId === zone.id}
                      onChange={() => setSelectedZoneId(zone.id)}
                      className="size-3.5"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{zone.name}</div>
                      <div className="text-[11px] text-muted-foreground">编码: {zone.code}</div>
                    </div>
                  </label>
                ))}

                {zones.length === 0 && (
                  <div className="py-4 text-center text-muted-foreground">
                    该数据中心下尚未创建安全域
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || zonesQuery.isLoading}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            保存安全域
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
