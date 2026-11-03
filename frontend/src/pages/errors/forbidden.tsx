import { useNavigate } from "react-router-dom"
import { ArrowLeft, ShieldOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

export default function ForbiddenPage({ description }: { description?: string }) {
  const navigate = useNavigate()
  return (
    <Empty className="min-h-[60vh] border border-dashed bg-card/40">
      <EmptyHeader>
        <EmptyMedia>
          <div className="relative flex size-16 items-center justify-center">
            <span className="absolute inset-0 rounded-2xl bg-destructive/10 motion-safe:animate-soft-ping" />
            <div className="relative flex size-14 items-center justify-center rounded-2xl border bg-background text-destructive shadow-sm">
              <ShieldOff className="size-7" />
            </div>
          </div>
        </EmptyMedia>
        <EmptyTitle className="text-base">没有访问权限</EmptyTitle>
        <EmptyDescription>{description ?? "当前账号的角色未授予该页面的访问权限，如需开通请联系系统管理员。"}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => navigate("/", { replace: true })}>
          <ArrowLeft />
          返回首页
        </Button>
      </EmptyContent>
    </Empty>
  )
}
