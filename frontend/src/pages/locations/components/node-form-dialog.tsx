import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FolderTree } from "lucide-react"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import {
  buildingsService,
  floorsService,
  roomsService,
  rackRowsService,
} from "@/services/locations"
import type { ManagedBase } from "@/services/managed"

export type NodeType = "building" | "floor" | "room" | "rack-row"

const nodeTypeMeta: Record<
  NodeType,
  { label: string; service: any; parentField: string }
> = {
  building: {
    label: "楼栋 / 建筑",
    service: buildingsService,
    parentField: "datacenter_id",
  },
  floor: {
    label: "楼层",
    service: floorsService,
    parentField: "building_id",
  },
  room: {
    label: "机房",
    service: roomsService,
    parentField: "floor_id",
  },
  "rack-row": {
    label: "机柜列",
    service: rackRowsService,
    parentField: "room_id",
  },
}

export function NodeFormDialog({
  open,
  type,
  parentId,
  node,
  onOpenChange,
}: {
  open: boolean
  type: NodeType
  parentId: string
  node?: ManagedBase | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const editing = Boolean(node)
  const meta = nodeTypeMeta[type]

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [level, setLevel] = useState("1")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(node?.code ?? "")
    setName(node?.name ?? "")
    setLevel((node as any)?.level !== undefined ? String((node as any).level) : "1")
    setDescription(node?.description ?? "")
    setError("")
  }, [open, node])

  const canSubmit = name.trim().length >= 2 && (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, any> = {
        name: name.trim(),
        description: description.trim() || undefined,
        [meta.parentField]: parentId,
      }
      if (type === "floor") {
        payload.level = Number(level)
      }

      if (editing && node) {
        return meta.service.update(node, payload)
      }
      return meta.service.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res: any) => {
      notify.success(
        editing ? `${meta.label}已更新` : `${meta.label}已创建`,
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["locations"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(
        getErrorMessage(
          err,
          editing ? `更新${meta.label}失败` : `创建${meta.label}失败`
        )
      ),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FolderTree className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? `编辑${meta.label}` : `新建${meta.label}`}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            在当前空间父级节点下新增或维护拓扑节点
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
          className="space-y-3 py-2"
        >
          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">编码 (Code) *</FieldLabel>
              <Input
                placeholder="如: room-101"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">名称 *</FieldLabel>
              <Input
                placeholder={`如: 1号机房 / A列`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
                required
              />
            </Field>
          </FieldGroup>

          {type === "floor" && (
            <Field>
              <FieldLabel className="text-xs">楼层层号 (Level) *</FieldLabel>
              <Input
                type="number"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>
          )}

          <Field>
            <FieldLabel className="text-xs">备注与描述</FieldLabel>
            <Textarea
              placeholder="位置补充说明..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={mutation.isPending}
              rows={2}
              className="text-xs"
            />
          </Field>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存" : "确定"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
