import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-form"
import {
  Network,
  AlertCircle,
  AlertOctagon,
  Lock,
  Unlock,
  Clock,
  Maximize2,
  Minimize2,
} from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/stores/auth-context"
import { QueryErrorState } from "@/components/common/query-error-state"
import { formatDateTime } from "@/lib/format"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { FormField, useAppForm } from "@/components/form"
import { notify } from "@/lib/notify"
import { newManagedIdempotencyKey } from "@/services/managed"
import { subnetsService, type SubnetDTO, type IPAddressView, type IPConflict } from "@/services/ipam"
import { cn } from "@/lib/utils"

type SheetWidthMode = "standard" | "wide" | "full"

const widthClasses: Record<SheetWidthMode, string> = {
  standard: "data-[side=right]:!w-full data-[side=right]:sm:!max-w-3xl",
  wide: "data-[side=right]:!w-full data-[side=right]:sm:!max-w-4xl data-[side=right]:xl:!max-w-5xl",
  full: "data-[side=right]:!w-full data-[side=right]:!max-w-[95vw]",
}

const gridColsClasses: Record<SheetWidthMode, string> = {
  standard: "grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2",
  wide: "grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 gap-2",
  full: "grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 2xl:grid-cols-16 gap-2",
}

const reservationLabels = { none: "无", manual: "人工", network: "网络地址", broadcast: "广播地址", gateway: "网关" }

export function IPAddressPoolSheet({
  open,
  subnet,
  onOpenChange,
}: {
  open: boolean
  subnet?: SubnetDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const canReserve = can("ipam:subnets:reserve")
  const canManageConflicts = can("ipam:subnets:conflicts")
  const canReadConflicts = can("ipam:subnets:history")
  const [widthMode, setWidthMode] = useState<SheetWidthMode>("wide")
  const [page, setPage] = useState(1)
  const pageSize = 64

  // Selected IP for actions
  const [selectedIP, setSelectedIP] = useState<IPAddressView | null>(null)
  const [reserveModalOpen, setReserveModalOpen] = useState(false)

  const [resolvingConflict, setResolvingConflict] = useState<IPConflict | null>(null)
  const [conflictPage, setConflictPage] = useState(1)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportKey, setReportKey] = useState("")

  const { data, isLoading, error } = useQuery({
    queryKey: ["subnets", "addresses", subnet?.id, page, pageSize],
    queryFn: ({ signal }) =>
      subnetsService.addresses(subnet!.id, page, pageSize, signal),
    enabled: open && Boolean(subnet?.id),
  })

  const addresses = data?.data.items ?? []
  const total = data?.data.total ?? 0

  const conflicts = useQuery({
    queryKey: ["subnets", "conflicts", subnet?.id, selectedIP?.address, conflictPage],
    queryFn: ({ signal }) => subnetsService.addressConflicts(subnet!.id, selectedIP!.address, conflictPage, 25, signal),
    enabled: open && Boolean(subnet && selectedIP?.conflicted) && canReadConflicts,
  })
  const selectedIsManual = selectedIP?.reservation_kind === "manual"
  const canChangeReservation = canReserve && subnet?.status === 1 && selectedIP?.allocation_state === "free"
    && (selectedIsManual || (selectedIP.reservation_kind === "none" && selectedIP.available))

  const refreshAddress = () => {
    void queryClient.invalidateQueries({ queryKey: ["subnets", "addresses", subnet?.id] })
    void queryClient.invalidateQueries({ queryKey: ["subnets", "conflicts", subnet?.id] })
    void queryClient.invalidateQueries({ queryKey: ["subnets", "address-history", subnet?.id] })
  }

  if (!subnet) return null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className={cn(
            "flex flex-col gap-0 p-0 transition-all duration-300",
            widthClasses[widthMode]
          )}
        >
          <SheetHeader className="border-b px-6 py-4 pr-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Network className="size-5 text-primary shrink-0" />
                <SheetTitle className="text-base font-semibold">
                  IP 地址池矩阵 ({subnet.cidr})
                </SheetTitle>
              </div>

              {/* 宽度调节与 VLAN 状态栏 */}
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center rounded-lg border border-border/70 bg-muted/40 p-0.5 text-xs"
                  role="group"
                  aria-label="抽屉宽度调整"
                >
                  <button
                    type="button"
                    onClick={() => setWidthMode("standard")}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                      widthMode === "standard"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="标准宽度 (768px)"
                  >
                    标准
                  </button>
                  <button
                    type="button"
                    onClick={() => setWidthMode("wide")}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                      widthMode === "wide"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="宽屏宽度 (1024px+)"
                  >
                    宽屏
                  </button>
                  <button
                    type="button"
                    onClick={() => setWidthMode("full")}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                      widthMode === "full"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="超宽全屏 (95vw)"
                  >
                    超宽
                  </button>
                </div>

                <Badge variant="outline" className="font-mono text-xs">
                  VLAN: {subnet.vlan_id ?? "未划定"}
                </Badge>
              </div>
            </div>

            <SheetDescription className="text-xs mt-1">
              网关: {subnet.gateway || "无"} | 用途: {subnet.usage_type} | 规划总地址: {total} 个
            </SheetDescription>
          </SheetHeader>

          {/* 5-State Legend & Tip */}
          <div className="flex flex-wrap items-center justify-between border-b bg-muted/20 px-6 py-2.5 text-xs gap-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="size-3 rounded-xs border border-emerald-500/40 bg-emerald-500/20" />
                <span className="whitespace-nowrap font-medium text-foreground/80">空闲 (Free)</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="size-3 rounded-xs border border-sky-500/50 bg-sky-500/20" />
                <span className="whitespace-nowrap font-medium text-foreground/80">预留 (Reserved)</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="size-3 rounded-xs border border-zinc-700 bg-zinc-800" />
                <span className="whitespace-nowrap font-medium text-foreground/80">在用 (In Use)</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="size-3 rounded-xs border border-amber-500/50 bg-amber-500/20" />
                <span className="whitespace-nowrap font-medium text-foreground/80">冷却 (Cooldown)</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="size-3 rounded-xs border border-destructive bg-destructive/30" />
                <span className="whitespace-nowrap font-medium text-foreground/80">冲突 (Conflicted)</span>
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground whitespace-nowrap hidden md:block">
              提示：点击任意 IP 卡片可查看详情、执行人工预留或报告冲突
            </div>
          </div>

          {/* IP Address Matrix Grid */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
                加载 IP 地址池失败，请稍后重试
              </div>
            ) : addresses.length === 0 ? (
              <div className="text-center py-12 text-xs text-muted-foreground">
                当前网段未持久化或无需地址池生成
              </div>
            ) : (
              <div className={gridColsClasses[widthMode]}>
                {addresses.map((ip) => {
                  const state = ip.allocation_state
                  const isConflicted = ip.conflicted
                  const isReserved = ip.reservation_kind !== "none" || state === "reserved"
                  const isInUse = state === "in_use"
                  const isCooldown = state === "quarantined" || Boolean(ip.cooldown_until)

                  return (
                    <button
                      key={ip.address}
                      type="button"
                      onClick={() => {
                        setConflictPage(1)
                        setSelectedIP(ip)
                      }}
                      className={cn(
                        "relative flex flex-col items-center justify-center min-h-[50px] py-1.5 px-1 rounded-md border text-center transition-all cursor-pointer hover:ring-2 hover:ring-primary/40 hover:scale-[1.04] hover:z-10 shadow-xs",
                        isConflicted
                          ? "bg-destructive/20 border-destructive text-destructive font-bold animate-pulse"
                          : isInUse
                          ? "bg-zinc-800 border-zinc-700 text-zinc-100"
                          : isReserved
                          ? "bg-sky-500/15 border-sky-500/40 text-sky-600 dark:text-sky-300 font-medium"
                          : isCooldown
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300"
                          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                      )}
                    >
                      <span className="font-mono text-xs font-semibold tracking-tight truncate w-full">
                        .{ip.address.split(".").pop()}
                      </span>
                      <span className="text-[10px] font-sans opacity-85 leading-none whitespace-nowrap mt-1">
                        {isConflicted
                          ? "冲突"
                          : isInUse
                          ? "在用"
                          : isReserved
                          ? "预留"
                          : isCooldown
                          ? "冷却"
                          : "空闲"}
                      </span>
                      {isConflicted && (
                        <AlertOctagon className="absolute top-1 right-1 size-3 text-destructive" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Pagination for Subnet IP Addresses */}
          {total > pageSize && (
            <div className="border-t px-6 py-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>共计 {total} 个地址</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <span>第 {page} 页</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* IP Detail & Action Dialog */}
      {selectedIP && !reserveModalOpen && !resolvingConflict && !reportOpen && (
        <Dialog open={Boolean(selectedIP)} onOpenChange={(op) => !op && setSelectedIP(null)}>
          <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Network className="size-5 text-primary" />
                <DialogTitle className="text-base font-semibold font-mono">
                  {selectedIP.address}
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs">
                IP 地址实时状态、人工保留及冲突事件控制
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 bg-muted/20">
                <div>
                  <span className="text-muted-foreground block text-[10px]">分配状态</span>
                  <Badge variant="outline" className="mt-0.5 capitalize">
                    {selectedIP.allocation_state}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">乐观锁版本</span>
                  <span className="font-mono font-semibold">v{selectedIP.version}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">冲突标志</span>
                  <span className={selectedIP.conflicted ? "text-destructive font-semibold" : "text-muted-foreground"}>
                    {selectedIP.conflicted ? "存在冲突事件" : "正常"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">可用性</span>
                  <span className={selectedIP.available ? "text-emerald-500 font-semibold" : "text-muted-foreground"}>
                    {selectedIP.available ? "可分配" : "不可分配"}
                  </span>
                </div>
              </div>

              <p>保留类型：{reservationLabels[selectedIP.reservation_kind]}</p>
              {selectedIP.conflicted && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="font-semibold text-destructive">存在未解除的冲突</p>
                  {!canReadConflicts ? <p>没有查看冲突记录的权限</p> :
                    conflicts.error ? <QueryErrorState label="冲突记录" error={conflicts.error} onRetry={() => void conflicts.refetch()} /> :
                    conflicts.isLoading ? <Spinner /> :
                    (conflicts.data?.data.items ?? []).map((conflict) => (
                      <div key={conflict.id} className="space-y-1 rounded-md border p-2">
                        <p className="break-all font-medium">{conflict.observed_identity}</p>
                        <p className="break-all text-muted-foreground">{conflict.evidence_ref} · {formatDateTime(conflict.observed_at)}</p>
                        {conflict.resolved_at ? <p>已解除：{conflict.resolution_reason}</p> : canManageConflicts && (
                          <Button size="xs" variant="outline" onClick={() => setResolvingConflict(conflict)}>解除此冲突</Button>
                        )}
                      </div>
                    ))}
                  {canReadConflicts && (conflictPage > 1 || (conflicts.data?.data.total ?? 0) > 25) && (
                    <div className="flex justify-between">
                      <Button size="xs" variant="outline" disabled={conflictPage === 1} onClick={() => setConflictPage(conflictPage - 1)}>上一页</Button>
                      <Button size="xs" variant="outline" disabled={conflictPage * 25 >= (conflicts.data?.data.total ?? 0)} onClick={() => setConflictPage(conflictPage + 1)}>下一页</Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIP(null)}
              >
                关闭
              </Button>
              {canManageConflicts && (
                <Button variant="outline" size="sm" onClick={() => {
                  setReportKey(newManagedIdempotencyKey())
                  setReportOpen(true)
                }}>报告冲突</Button>
              )}
              {canChangeReservation && (
                <Button size="sm" variant={selectedIsManual ? "secondary" : "default"} onClick={() => setReserveModalOpen(true)}>
                  {selectedIsManual ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
                  {selectedIsManual ? "取消人工保留" : "设定人工保留"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Set/Cancel Reservation Modal */}
      <ReserveIPModal
        open={reserveModalOpen && Boolean(selectedIP)}
        subnetId={subnet.id}
        selectedIP={selectedIP}
        selectedIsManual={selectedIsManual}
        onOpenChange={setReserveModalOpen}
        onSuccess={() => {
          refreshAddress()
          setReserveModalOpen(false)
          setSelectedIP(null)
        }}
      />

      {/* Resolve Conflict Modal */}
      <ResolveIPConflictModal
        open={Boolean(resolvingConflict && selectedIP)}
        subnetId={subnet.id}
        selectedIP={selectedIP}
        conflict={resolvingConflict}
        onOpenChange={(next) => {
          if (!next) setResolvingConflict(null)
        }}
        onSuccess={() => {
          refreshAddress()
          setResolvingConflict(null)
          setSelectedIP(null)
        }}
      />

      {/* Report Conflict Modal */}
      <ReportIPConflictModal
        open={reportOpen && Boolean(selectedIP)}
        subnetId={subnet.id}
        selectedIP={selectedIP}
        idempotencyKey={reportKey}
        onOpenChange={setReportOpen}
        onSuccess={() => {
          refreshAddress()
          setReportOpen(false)
          setSelectedIP(null)
        }}
      />
    </>
  )
}

const reasonSchema = z.object({
  reason: z.string().trim().min(1, "请填写原因说明").max(256, "原因说明不能超过 256 个字符"),
})

const reportConflictSchema = z.object({
  observedIdentity: z.string().trim().min(1, "请输入观测到的标识").max(128, "标识长度不能超过 128 个字符"),
  evidenceRef: z.string().trim().min(1, "请输入证据引用").max(256, "证据引用不能超过 256 个字符"),
  observedAt: z
    .string()
    .trim()
    .min(1, "请选择观测时间")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "请选择有效的观测时间"),
})

function ReserveIPModal({
  open,
  subnetId,
  selectedIP,
  selectedIsManual,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  subnetId: string
  selectedIP: IPAddressView | null
  selectedIsManual: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const defaultValues = useMemo(() => ({ reason: "" }), [])
  const mutation = useMutation({
    mutationFn: ({ reason }: { reason: string }) =>
      subnetsService.reserveAddress(
        subnetId,
        selectedIP!.address,
        selectedIP!.version,
        !selectedIsManual,
        reason.trim(),
      ),
    onSuccess: (res) => {
      notify.success("IP 状态已变更", `${res.data.address} 人工预留已更新`)
      onSuccess()
    },
  })

  const { form, formRef, submit, formError } = useAppForm({
    open,
    resetKey: selectedIP?.address ?? "none",
    defaultValues,
    schema: reasonSchema,
    serverFieldNames: { reason: "reason" },
    fallbackErrorMessage: "变更预留状态失败",
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
  })

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const busy = mutation.isPending || isSubmitting

  if (!open || !selectedIP) return null

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {selectedIsManual ? "取消人工保留" : "设置人工预留"} ({selectedIP.address})
          </DialogTitle>
          <DialogDescription className="text-xs">
            预留后该 IP 将被锁定，防止自动化上架与工单系统自动占用分配
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
          className="space-y-3 py-2"
        >
          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <form.Field name="reason">
            {(field) => (
              <FormField field={field} label="变更原因与业务依据" idPrefix="ip-reserve" required>
                {(inputProps) => (
                  <Textarea
                    {...inputProps}
                    placeholder="如: 预留给数据库高可用 VIP / 专线网关路由..."
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    disabled={busy}
                    maxLength={256}
                    rows={3}
                    className="text-xs"
                  />
                )}
              </FormField>
            )}
          </form.Field>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : "确认提交"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResolveIPConflictModal({
  open,
  subnetId,
  selectedIP,
  conflict,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  subnetId: string
  selectedIP: IPAddressView | null
  conflict: IPConflict | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const defaultValues = useMemo(() => ({ reason: "" }), [])
  const mutation = useMutation({
    mutationFn: ({ reason }: { reason: string }) =>
      subnetsService.resolveConflict(subnetId, selectedIP!.address, conflict!.id, reason.trim()),
    onSuccess: () => {
      notify.success("冲突已解除", `${selectedIP!.address} 冲突已解除并归档`)
      onSuccess()
    },
  })

  const { form, formRef, submit, formError } = useAppForm({
    open,
    resetKey: conflict?.id ?? "none",
    defaultValues,
    schema: reasonSchema,
    serverFieldNames: { reason: "reason" },
    fallbackErrorMessage: "解除冲突失败",
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
  })

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const busy = mutation.isPending || isSubmitting

  if (!open || !selectedIP || !conflict) return null

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            解除 IP 冲突 ({selectedIP.address})
          </DialogTitle>
          <DialogDescription className="text-xs">
            处置冲突事件并归档，解除后原有人工保留或占用状态仍按规则生效
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
          className="space-y-3 py-2"
        >
          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <form.Field name="reason">
            {(field) => (
              <FormField field={field} label="冲突处置原因说明" idPrefix="ip-resolve" required>
                {(inputProps) => (
                  <Textarea
                    {...inputProps}
                    placeholder="如: 现场已拔除非法私接设备网线，已确认恢复单节点占用..."
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    disabled={busy}
                    maxLength={256}
                    rows={3}
                    className="text-xs"
                  />
                )}
              </FormField>
            )}
          </form.Field>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" size="sm" variant="destructive" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : "确认解除冲突"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ReportIPConflictModal({
  open,
  subnetId,
  selectedIP,
  idempotencyKey,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  subnetId: string
  selectedIP: IPAddressView | null
  idempotencyKey: string
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const defaultValues = useMemo(
    () => ({ observedIdentity: "", evidenceRef: "", observedAt: "" }),
    [],
  )
  const mutation = useMutation({
    mutationFn: (values: { observedIdentity: string; evidenceRef: string; observedAt: string }) =>
      subnetsService.reportConflict(
        subnetId,
        selectedIP!.address,
        {
          observed_identity: values.observedIdentity.trim(),
          evidence_ref: values.evidenceRef.trim(),
          observed_at: new Date(values.observedAt).toISOString(),
        },
        idempotencyKey,
      ),
    onSuccess: () => {
      notify.success("已报告 IP 冲突")
      onSuccess()
    },
  })

  const { form, formRef, submit, formError } = useAppForm({
    open,
    resetKey: idempotencyKey || "report",
    defaultValues,
    schema: reportConflictSchema,
    serverFieldNames: {
      observed_identity: "observedIdentity",
      evidence_ref: "evidenceRef",
      observed_at: "observedAt",
    },
    fallbackErrorMessage: "报告冲突失败",
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
  })

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const busy = mutation.isPending || isSubmitting

  if (!open || !selectedIP) return null

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>报告 IP 冲突</DialogTitle>
          <DialogDescription>{selectedIP.address}</DialogDescription>
        </DialogHeader>
        <form
          ref={formRef}
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void submit()
          }}
        >
          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <FieldGroup className="gap-3">
            <form.Field name="observedIdentity">
              {(field) => (
                <FormField field={field} label="观测到的标识" id="ip-conflict-identity" required>
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      maxLength={128}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={busy}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
            <form.Field name="evidenceRef">
              {(field) => (
                <FormField field={field} label="证据引用" id="ip-conflict-evidence" required>
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      maxLength={256}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={busy}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
            <form.Field name="observedAt">
              {(field) => (
                <FormField field={field} label="观测时间" id="ip-conflict-time" required>
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      type="datetime-local"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={busy}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : "提交冲突报告"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
