import { useQuery } from "@tanstack/react-query"
import { usersService } from "@/services/users"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
export function UserRowDetail({ id, actorID }: { id: string; actorID: string }) {
  const query = useQuery({
    queryKey: ["users", "row-detail", actorID, id],
    queryFn: async ({ signal }) => (await usersService.get(id, signal)).data,
    staleTime: 30000,
    gcTime: 60000,
    retry: false,
  })
  if (query.isPending) return <Skeleton className="h-16 w-full" aria-label="正在加载行详情" />
  if (query.isError)
    return (
      <div role="alert">
        详情加载失败{" "}
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          重试详情
        </Button>
      </div>
    )
  const user = query.data
  return (
    <dl aria-label="用户行详情" className="grid grid-cols-12 gap-3 text-sm">
      <div className="col-span-12 sm:col-span-6">
        <dt className="text-muted-foreground">用户名</dt>
        <dd>{user.username}</dd>
      </div>
      <div className="col-span-12 sm:col-span-6">
        <dt className="text-muted-foreground">邮箱</dt>
        <dd className="break-all">{user.email || "—"}</dd>
      </div>
      <div className="col-span-12">
        <dt className="text-muted-foreground">角色</dt>
        <dd>{user.roles?.map((role) => role.name).join("、") || "未分配"}</dd>
      </div>
    </dl>
  )
}
