import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom"
import { ArrowLeft, RotateCcw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

// Vite reports a missing hashed chunk (usually after a redeploy) with one of these messages.
const chunkLoadFailure = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i

export function RouteError({ fullscreen = false }: { fullscreen?: boolean }) {
  const error = useRouteError()
  const navigate = useNavigate()
  const message = error instanceof Error ? error.message : ""
  const stale = chunkLoadFailure.test(message)
  const status = isRouteErrorResponse(error) ? error.status : undefined

  return (
    <div className={cn("flex w-full items-center justify-center", fullscreen ? "min-h-svh p-6" : "min-h-[60vh]")}>
      <Empty role="alert" className="max-w-md border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>{stale ? "页面版本已更新" : status === 404 ? "页面不存在" : "页面出现异常"}</EmptyTitle>
          <EmptyDescription>
            {stale
              ? "控制台刚刚完成升级，当前页面资源已失效。重新加载即可使用最新版本。"
              : "该页面渲染时发生错误，已阻止其影响其他模块。可以重新加载，或先返回首页继续工作。"}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button onClick={() => window.location.reload()}>
            <RotateCcw />
            重新加载
          </Button>
          {!stale && (
            <Button variant="outline" onClick={() => navigate("/", { replace: true })}>
              <ArrowLeft />
              返回首页
            </Button>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}
