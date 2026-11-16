import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CheckCircle2, Cpu, HardDrive, XCircle } from "lucide-react"
import { AssetStatusBadge } from "@/components/receiving/receiving-meta"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateTime } from "@/lib/format"
import { queryKeys } from "@/lib/query-keys"
import { receiptsService } from "@/services/receipts"
import { useAuth } from "@/stores/auth-context"

export function ReceiptResultView({ receiptId }: { receiptId: string }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const canReadDevices = can("assets:devices:read")
  const canReadComponents = can("assets:components:read")

  const resultQuery = useQuery({
    queryKey: queryKeys.receiptResult(receiptId),
    queryFn: ({ signal }) => receiptsService.result(receiptId, signal),
    enabled: Boolean(receiptId),
  })

  const itemsQuery = useQuery({
    queryKey: queryKeys.receiptResultItems(receiptId, { page: 1, page_size: 100 }),
    queryFn: ({ signal }) => receiptsService.resultItems(receiptId, { page: 1, page_size: 100 }, signal),
    enabled: Boolean(receiptId),
  })

  const summary = resultQuery.data?.data
  const items = itemsQuery.data?.data.items ?? []

  if (!summary) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">验收结果汇总与入库台账</CardTitle>
            <CardDescription className="text-xs">
              完成于 {formatDateTime(summary.completed_at, "yyyy-MM-dd HH:mm:ss")} · 动作 ID {summary.action_id}
            </CardDescription>
          </div>
          {canReadComponents && summary.created_part_count > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/assets/components?serial_status=missing")}
            >
              <Cpu className="mr-1.5 size-4" />
              前往组件资产补录待补序列号
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 sm:col-span-4 rounded-lg border bg-emerald-500/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600" />
              验收通过设备
            </div>
            <div className="mt-1 text-2xl font-semibold">{summary.accepted_device_count} 台</div>
          </div>
          <div className="col-span-12 sm:col-span-4 rounded-lg border bg-destructive/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <XCircle className="size-4 text-destructive" />
              拒收设备
            </div>
            <div className="mt-1 text-2xl font-semibold">{summary.rejected_device_count} 台</div>
          </div>
          <div className="col-span-12 sm:col-span-4 rounded-lg border bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HardDrive className="size-4 text-primary" />
              生成组件资产
            </div>
            <div className="mt-1 text-2xl font-semibold">{summary.created_part_count} 件</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">逐台生成资产明细 ({items.length})</div>
          {items.map((item, idx) => (
            <div
              key={item.receipt_item_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-muted-foreground">#{idx + 1}</span>
                <AssetStatusBadge state={item.inspection_result} />
                {item.device_id ? (
                  <span className="font-mono">设备 ID: {item.device_id}</span>
                ) : (
                  <span className="text-muted-foreground">已拒收，未建设备资产</span>
                )}
                <span className="text-muted-foreground">· 建账组件 {item.part_count} 件</span>
              </div>

              {item.device_id && canReadDevices && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => navigate(`/assets/devices/${item.device_id}`)}
                >
                  查看设备资产详情
                  <ArrowRight className="ml-1 size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
