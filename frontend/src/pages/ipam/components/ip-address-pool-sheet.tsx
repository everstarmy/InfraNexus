import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Network,
  AlertOctagon,
  Lock,
  Unlock,
  Clock,
} from "lucide-react"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/stores/auth-context"
import { QueryErrorState } from "@/components/common/query-error-state"
import { formatDateTime } from "@/lib/format"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { notify } from "@/lib/notify"
import { getErrorMessage } from "@/lib/api-error"
import { newManagedIdempotencyKey } from "@/services/managed"
import { subnetsService, type SubnetDTO, type IPAddressView, type IPConflict } from "@/services/ipam"

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
  const [page, setPage] = useState(1)
  const pageSize = 64

  // Selected IP for actions
  const [selectedIP, setSelectedIP] = useState<IPAddressView | null>(null)
  const [reserveModalOpen, setReserveModalOpen] = useState(false)
  const [reserveReason, setReserveReason] = useState("")

  const [resolvingConflict, setResolvingConflict] = useState<IPConflict | null>(null)
  const [conflictPage, setConflictPage] = useState(1)
  const [reportOpen, setReportOpen] = useState(false)
  const [observedIdentity, setObservedIdentity] = useState("")
  const [evidenceRef, setEvidenceRef] = useState("")
  const [observedAt, setObservedAt] = useState("")
  const [reportKey, setReportKey] = useState("")
  const [resolveReason, setResolveReason] = useState("")

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

  // Reservation Mutation
  const reserveMutation = useMutation({
    mutationFn: () => {
      const isReserved = selectedIP?.reservation_kind === "manual"
      return subnetsService.reserveAddress(
        subnet!.id,
        selectedIP!.address,
        selectedIP!.version,
        !isReserved,
        reserveReason.trim()
      )
    },
    onSuccess: (res) => {
      notify.success("IP 状态已变更", `${res.data.address} 人工预留已更新`)
      refreshAddress()
      setReserveModalOpen(false)
      setSelectedIP(null)
      setReserveReason("")
    },
    onError: (err) =>
      notify.error("变更预留状态失败", getErrorMessage(err)),
  })

  // Conflict Resolve Mutation
  const resolveMutation = useMutation({
    mutationFn: () =>
      subnetsService.resolveConflict(
        subnet!.id,
        selectedIP!.address,
        resolvingConflict!.id,
        resolveReason.trim()
      ),
    onSuccess: () => {
      notify.success("冲突已解除", `${selectedIP!.address} 冲突已解除并归档`)
      refreshAddress()
      setResolvingConflict(null)
      setSelectedIP(null)
      setResolveReason("")
    },
    onError: (err) =>
      notify.error("解除冲突失败", getErrorMessage(err)),
  })

  const reportMutation = useMutation({
    mutationFn: () => subnetsService.reportConflict(subnet!.id, selectedIP!.address, {
      observed_identity: observedIdentity.trim(),
      evidence_ref: evidenceRef.trim(),
      observed_at: new Date(observedAt).toISOString(),
    }, reportKey),
    onSuccess: () => {
      refreshAddress()
      setReportOpen(false)
      setSelectedIP(null)
      notify.success("已报告 IP 冲突")
    },
    onError: (error) => notify.error("报告冲突失败", getErrorMessage(error)),
  })

  if (!subnet) return null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-2xl p-0">
          <SheetHeader className="border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="size-5 text-primary" />
                <SheetTitle className="text-base font-semibold">
                  IP 地址池矩阵 ({subnet.cidr})
                </SheetTitle>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                VLAN: {subnet.vlan_id ?? "未划定"}
              </Badge>
            </div>
            <SheetDescription className="text-xs">
              网关: {subnet.gateway || "无"} | 用途: {subnet.usage_type} | 规划总地址: {total} 个
            </SheetDescription>
          </SheetHeader>

          {/* 5-State Legend */}
          <div className="flex flex-wrap items-center justify-between border-b bg-muted/20 px-6 py-2.5 text-xs">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-xs border border-emerald-500/40 bg-emerald-500/20" />
                <span>空闲 (Free)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-xs border border-sky-500/50 bg-sky-500/20" />
                <span>预留 (Reserved)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-xs border border-zinc-700 bg-zinc-800" />
                <span>在用 (In Use)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-xs border border-amber-500/50 bg-amber-500/20" />
                <span>冷却 (Cooldown)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-xs border border-destructive bg-destructive/30" />
                <span>冲突 (Conflicted)</span>
              </span>
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
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
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
                      className={`relative flex flex-col items-center justify-center p-2 rounded-md border text-center transition-all cursor-pointer hover:ring-2 hover:ring-primary/40 ${
                        isConflicted
                          ? "bg-destructive/20 border-destructive text-destructive font-bold animate-pulse"
                          : isInUse
                          ? "bg-zinc-800 border-zinc-700 text-zinc-100"
                          : isReserved
                          ? "bg-sky-500/15 border-sky-500/40 text-sky-600 dark:text-sky-300 font-medium"
                          : isCooldown
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300"
                          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                      }`}
                    >
                      <span className="font-mono text-[11px] truncate w-full">
                        .{ip.address.split(".").pop()}
                      </span>
                      <span className="text-[9px] font-sans opacity-80 scale-90">
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
                        <AlertOctagon className="absolute top-1 right-1 size-2.5 text-destructive" />
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
                          <Button size="xs" variant="outline" onClick={() => {
                            setResolveReason("")
                            setResolvingConflict(conflict)
                          }}>解除此冲突</Button>
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
                  setObservedIdentity("")
                  setEvidenceRef("")
                  setObservedAt("")
                  setReportKey(newManagedIdempotencyKey())
                  setReportOpen(true)
                }}>报告冲突</Button>
              )}
              {canChangeReservation && (
                <Button size="sm" variant={selectedIsManual ? "secondary" : "default"} onClick={() => {
                  setReserveReason("")
                  setReserveModalOpen(true)
                }}>
                  {selectedIsManual ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
                  {selectedIsManual ? "取消人工保留" : "设定人工保留"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Set/Cancel Reservation Modal */}
      {reserveModalOpen && selectedIP && (
        <Dialog open={reserveModalOpen} onOpenChange={(open) => !reserveMutation.isPending && setReserveModalOpen(open)}>
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
              onSubmit={(e) => {
                e.preventDefault()
                reserveMutation.mutate()
              }}
              className="space-y-3 py-2"
            >
              <Field>
                <FieldLabel className="text-xs">变更原因与业务依据 *</FieldLabel>
                <Textarea
                  placeholder="如: 预留给数据库高可用 VIP / 专线网关路由..."
                  value={reserveReason}
                  onChange={(e) => setReserveReason(e.target.value)}
                  disabled={reserveMutation.isPending}
                  maxLength={256}
                  required
                  rows={3}
                  className="text-xs"
                />
              </Field>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReserveModalOpen(false)}
                  disabled={reserveMutation.isPending}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!reserveReason.trim() || reserveMutation.isPending}
                >
                  {reserveMutation.isPending ? <Spinner className="size-4" /> : "确认提交"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Resolve Conflict Modal */}
      {resolvingConflict && selectedIP && (
        <Dialog open onOpenChange={(open) => !open && !resolveMutation.isPending && setResolvingConflict(null)}>
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
              onSubmit={(e) => {
                e.preventDefault()
                resolveMutation.mutate()
              }}
              className="space-y-3 py-2"
            >
              <Field>
                <FieldLabel className="text-xs">冲突处置处置原因说明 *</FieldLabel>
                <Textarea
                  placeholder="如: 现场已拔除非法私接设备网线，已确认恢复单节点占用..."
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                  disabled={resolveMutation.isPending}
                  maxLength={256}
                  required
                  rows={3}
                  className="text-xs"
                />
              </Field>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setResolvingConflict(null)}
                  disabled={resolveMutation.isPending}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  disabled={!resolveReason.trim() || resolveMutation.isPending}
                >
                  {resolveMutation.isPending ? <Spinner className="size-4" /> : "确认解除冲突"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {reportOpen && selectedIP && (
        <Dialog open onOpenChange={(open) => !open && !reportMutation.isPending && setReportOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>报告 IP 冲突</DialogTitle>
              <DialogDescription>{selectedIP.address}</DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault()
              if (!reportMutation.isPending) reportMutation.mutate()
            }}>
              <Field><FieldLabel htmlFor="ip-conflict-identity">观测到的标识</FieldLabel><Input id="ip-conflict-identity" required maxLength={128} value={observedIdentity} onChange={(event) => setObservedIdentity(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="ip-conflict-evidence">证据引用</FieldLabel><Input id="ip-conflict-evidence" required maxLength={256} value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="ip-conflict-time">观测时间</FieldLabel><Input id="ip-conflict-time" required type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></Field>
              <DialogFooter><Button type="submit" disabled={reportMutation.isPending || !observedIdentity.trim() || !evidenceRef.trim() || !observedAt}>提交冲突报告</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
