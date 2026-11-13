import { useQuery } from "@tanstack/react-query"
import { Link2, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import type { ManagedReferenceCount } from "@/services/managed"
import type { Envelope } from "@/services/types"

const resourceLabels: Record<string, string> = {
  dc_location: "位置节点",
  dc_rack_security_zone: "机柜安全域",
  dc_rack_unit_allocation: "机柜 U 位占用",
  dc_warehouse: "库房",
  dc_shelf: "货架",
  dc_bin: "库位",
  dc_temporary_location: "临时保管位置",
  ipam_security_zone: "安全域",
  ipam_subnet: "子网",
  ipam_ip_address: "IP 地址记录",
  ipam_conflict: "IP 冲突事件",
  org_company_contact: "组织联系人",
  org_company: "供应商/服务商",
  users: "系统用户",
}

export function ManagedReferencesDialog({
  open,
  onOpenChange,
  resourceTitle,
  recordName,
  recordId,
  fetchReferences,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceTitle: string
  recordName?: string
  recordId?: string | null
  fetchReferences: (id: string, signal?: AbortSignal) => Promise<Envelope<ManagedReferenceCount[]>>
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["managed", "references", recordId],
    queryFn: ({ signal }) => fetchReferences(recordId!, signal),
    enabled: open && Boolean(recordId),
  })

  const refs = data?.data ?? []
  const totalCount = refs.reduce((acc, r) => acc + r.count, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Link2 className="size-4.5 text-primary" />
            <DialogTitle className="text-base font-semibold">关联引用情况</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {resourceTitle} {recordName ? `「${recordName}」` : ""} 的下级或关联依赖统计
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
              加载引用信息失败
            </div>
          ) : refs.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
              当前记录暂无其他资源引用，可安全操作。
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <AlertCircle className="size-4 shrink-0" />
                <span>
                  共计被 <strong className="font-semibold">{totalCount}</strong> 个关联对象引用。受引用的记录无法直接删除或随意停用。
                </span>
              </div>

              <div className="divide-y rounded-md border text-xs">
                {refs.map((ref, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5">
                    <span className="font-medium text-foreground">
                      {resourceLabels[ref.resource] ?? ref.resource}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-[11px] font-mono">
                        字段: {ref.field}
                      </span>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {ref.count}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
