import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Info, MousePointerClick, PanelsTopLeft, Webhook } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { collectIds, findNode } from "@/lib/tree"
import { permissionsService, type PermissionDTO, type PermissionType } from "@/services/permissions"

const ROOT = "__root__"
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "*"]

function flattenWithDepth(nodes: PermissionDTO[], depth = 0): Array<{ node: PermissionDTO; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenWithDepth(node.children ?? [], depth + 1)])
}

export type PermissionFormState = { mode: "create"; parentId: string | null } | { mode: "edit"; permission: PermissionDTO } | null

export function PermissionFormDialog({ state, tree, onOpenChange }: { state: PermissionFormState; tree: PermissionDTO[]; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const editing = state?.mode === "edit" ? state.permission : null
  const locked = !!editing?.built_in
  const [parentId, setParentId] = useState<string>(ROOT)
  const [type, setType] = useState<PermissionType>("menu")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [codeTouched, setCodeTouched] = useState(false)
  const [path, setPath] = useState("")
  const [method, setMethod] = useState("GET")
  const [icon, setIcon] = useState("")
  const [sortOrder, setSortOrder] = useState("0")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!state) return
    const p = state.mode === "edit" ? state.permission : null
    const parent = state.mode === "create" ? state.parentId : (p?.parent_id ?? null)
    const parentNode = parent ? findNode(tree, parent) : undefined
    setParentId(parent ?? ROOT)
    setType(p?.type ?? (parentNode?.type === "button" ? "api" : parentNode ? "button" : "menu"))
    setName(p?.name ?? "")
    setCode(p?.code ?? "")
    setCodeTouched(!!p)
    setPath(p?.path ?? "")
    setMethod(p?.method || "GET")
    setIcon(p?.icon ?? "")
    setSortOrder(String(p?.sort_order ?? 0))
    setError("")
  }, [state, tree])

  useEffect(() => {
    if (!codeTouched && type === "api" && path) setCode(`api:${method}:${path}`)
  }, [codeTouched, type, method, path])

  const blocked = useMemo(() => new Set(editing ? collectIds(editing) : []), [editing])
  const parentOptions = useMemo(
    () => flattenWithDepth(tree).filter(({ node }) => node.type !== "api" && !blocked.has(node.id)),
    [tree, blocked],
  )
  const parentItems = useMemo(
    () => [{ value: ROOT, label: "无（顶级节点）" }, ...parentOptions.map(({ node, depth }) => ({ value: node.id, label: `${"　".repeat(depth)}${node.name}` }))],
    [parentOptions],
  )

  const valid = name.trim() && code.trim().length >= 2 && (type !== "api" || (path.startsWith("/") && method))

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        parent_id: parentId === ROOT ? null : parentId,
        type,
        name: name.trim(),
        code: code.trim(),
        path: type === "button" ? "" : path.trim(),
        method: type === "api" ? method : "",
        icon: type === "menu" ? icon.trim() : "",
        sort_order: Number(sortOrder) || 0,
      }
      return editing ? permissionsService.update(editing.id, payload) : permissionsService.create(payload)
    },
    onSuccess: (res) => {
      notify.success(editing ? "权限点已更新" : "权限点已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["permissions"] })
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      onOpenChange(false)
    },
    onError: (err) => setError(getErrorMessage(err, "保存失败")),
  })

  return (
    <Dialog open={!!state} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑权限点" : "新建权限点"}</DialogTitle>
          <DialogDescription>菜单控制导航可见性，按钮控制界面操作，接口由服务端在每次请求时强制鉴权</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) mutation.mutate()
          }}
        >
          {error && (
            <Alert variant="destructive">
              <Info />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {locked && (
            <Alert>
              <Info />
              <AlertDescription>内置权限点与系统路由绑定，仅可修改名称、图标与排序。</AlertDescription>
            </Alert>
          )}
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>节点类型</FieldLabel>
              <ToggleGroup
                variant="outline"
                value={[type]}
                onValueChange={(v) => v[0] && setType(v[0] as PermissionType)}
                disabled={locked}
                className="w-full"
              >
                <ToggleGroupItem value="menu" className="flex-1 gap-1.5">
                  <PanelsTopLeft />
                  菜单
                </ToggleGroupItem>
                <ToggleGroupItem value="button" className="flex-1 gap-1.5">
                  <MousePointerClick />
                  按钮
                </ToggleGroupItem>
                <ToggleGroupItem value="api" className="flex-1 gap-1.5">
                  <Webhook />
                  接口
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="perm-parent">上级节点</FieldLabel>
              <Select value={parentId} onValueChange={(v) => setParentId(String(v))} items={parentItems} disabled={locked}>
                <SelectTrigger id="perm-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {parentItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="perm-name">名称</FieldLabel>
                <Input id="perm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 导出报表" />
              </Field>
              <Field>
                <FieldLabel htmlFor="perm-code">权限编码</FieldLabel>
                <Input
                  id="perm-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    setCodeTouched(true)
                  }}
                  placeholder={type === "button" ? "如 reports:export" : type === "menu" ? "如 reports" : "自动生成"}
                  className="font-mono"
                  disabled={locked}
                />
              </Field>
            </div>
            {type !== "button" && (
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field>
                  <FieldLabel htmlFor="perm-path">{type === "api" ? "接口路径" : "前端路由"}</FieldLabel>
                  <Input
                    id="perm-path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder={type === "api" ? "/api/v1/reports/:id" : "/reports"}
                    className="font-mono"
                    disabled={locked}
                  />
                  {type === "api" && <FieldDescription>支持 :param 路径参数（keyMatch2）</FieldDescription>}
                </Field>
                {type === "api" && (
                  <Field>
                    <FieldLabel htmlFor="perm-method">HTTP 方法</FieldLabel>
                    <Select value={method} onValueChange={(v) => setMethod(String(v))} disabled={locked}>
                      <SelectTrigger id="perm-method" className="w-full font-mono">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {METHODS.map((m) => (
                          <SelectItem key={m} value={m} className="font-mono">
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {type === "menu" && (
                <Field>
                  <FieldLabel htmlFor="perm-icon">图标</FieldLabel>
                  <Input id="perm-icon" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="lucide 图标名，如 BarChart3" />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="perm-sort">排序值</FieldLabel>
                <Input id="perm-sort" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {editing ? "保存修改" : "创建权限点"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
