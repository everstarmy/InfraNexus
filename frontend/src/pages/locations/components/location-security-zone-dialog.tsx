import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react"
import { z } from "zod"
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
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { securityZonesService } from "@/services/ipam"
import { locationsService, type LocationNode } from "@/services/locations"

const locationSecurityZoneSchema = z.object({
  selectedZoneId: z.string(),
})

type LocationSecurityZoneValues = z.infer<typeof locationSecurityZoneSchema>

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
  const confirm = useConfirm()

  const datacenter = rack?.path?.find((p) => p.type === "datacenter")

  const defaultValues = useMemo<LocationSecurityZoneValues>(
    () => ({
      selectedZoneId: rack?.security_zone_id ?? "",
    }),
    [rack?.uid, rack?.security_zone_id],
  )

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
    mutationFn: async (values: LocationSecurityZoneValues) => {
      if (!rack) throw new Error("未选择机柜")
      const zonePayload = values.selectedZoneId ? values.selectedZoneId : null
      const res = await locationsService.securityZone(rack.uid, rack.version, zonePayload)
      return res.data
    },
    onSuccess: (updated) => {
      notify.success("机柜安全域设置已更新")
      void queryClient.invalidateQueries({ queryKey: ["location-nodes"] })
      onSuccess?.(updated)
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<LocationSecurityZoneValues>({
    defaultValues,
    resetKey: rack?.uid,
    schema: locationSecurityZoneSchema,
    serverFieldNames: { security_zone_id: "selectedZoneId" },
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: "设置机柜安全域失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "机柜安全域选择尚未保存，关闭后更改将丢失。")

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃更改？",
        description: "当前安全域选择尚未保存，离开后未保存的更改将丢失。",
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  if (!rack) return null

  const zones = zonesQuery.data ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void requestClose()
        else onOpenChange(true)
      }}
    >
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

        {formError && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertCircle className="size-4" />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
          className="space-y-3 text-xs"
        >
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
                  type="button"
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
              <form.Field name="selectedZoneId">
                {(field) => (
                  <FormField field={field} id="rack-security-zone">
                    {({ "aria-invalid": ariaInvalid, "aria-describedby": describedBy }) => (
                      <div role="radiogroup" aria-label="安全域" className="space-y-1 max-h-56 overflow-y-auto rounded-md border p-1">
                        <label className="flex items-center gap-2 rounded p-2 hover:bg-muted cursor-pointer transition-colors">
                          <input
                            type="radio"
                            aria-invalid={ariaInvalid}
                            aria-describedby={describedBy}
                            name="security_zone"
                            checked={field.state.value === ""}
                            onChange={() => field.handleChange("")}
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
                              aria-invalid={ariaInvalid}
                              aria-describedby={describedBy}
                              name="security_zone"
                              checked={field.state.value === zone.id}
                              onChange={() => field.handleChange(zone.id)}
                              className="size-3.5"
                            />
                            <div className="flex-1">
                              <div className="font-medium">{zone.name}</div>
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
                  </FormField>
                )}
              </form.Field>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestClose()}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting]}>
              {([isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={isSubmitting || mutation.isPending || zonesQuery.isLoading}
                >
                  {(isSubmitting || mutation.isPending) && (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  )}
                  保存安全域
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
