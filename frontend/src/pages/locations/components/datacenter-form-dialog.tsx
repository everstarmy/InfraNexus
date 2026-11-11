import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import {
  datacentersService,
  type DatacenterDTO,
  type DatacenterKind,
} from "@/services/locations"

export function DatacenterFormDialog({
  open,
  datacenter,
  onOpenChange,
}: {
  open: boolean
  datacenter?: DatacenterDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = Boolean(datacenter)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [kind, setKind] = useState<DatacenterKind>("primary")
  const [address, setAddress] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(datacenter?.code ?? "")
    setName(datacenter?.name ?? "")
    setKind(datacenter?.kind ?? "primary")
    setAddress(datacenter?.address ?? "")
    setDescription(datacenter?.description ?? "")
    setError("")
  }, [open, datacenter])

  const isDirty =
    open &&
    (code !== (datacenter?.code ?? "") ||
      name !== (datacenter?.name ?? "") ||
      kind !== (datacenter?.kind ?? "primary") ||
      address !== (datacenter?.address ?? "") ||
      description !== (datacenter?.description ?? ""))

  useUnsavedChanges(isDirty, "数据中心信息尚未保存，关闭后这些更改将丢失。")

  const canSubmit =
    name.trim().length >= 2 &&
    (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<DatacenterDTO> = {
        name: name.trim(),
        kind,
        address: address.trim() || undefined,
        description: description.trim() || undefined,
      }
      if (editing && datacenter) {
        return datacentersService.update(datacenter, payload)
      }
      return datacentersService.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "数据中心已更新" : "数据中心已创建",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["datacenters"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(
        getErrorMessage(err, editing ? "更新数据中心失败" : "创建数据中心失败")
      ),
  })

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃更改？",
        description: "当前表单尚未保存，离开后未保存的更改将丢失。",
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void requestClose()
        else onOpenChange(true)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑数据中心" : "新建数据中心 (DC)"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            定义物理数据中心园区、容灾等级及地理位置
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
              <FieldLabel className="text-xs">DC 编码 *</FieldLabel>
              <Input
                placeholder="如: dc-beijing-01"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">数据中心名称 *</FieldLabel>
              <Input
                placeholder="如: 北京亦庄核心数据中心"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
                required
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel className="text-xs">园区容灾角色 *</FieldLabel>
            <NativeSelect
              value={kind}
              onChange={(e) => setKind(e.target.value as DatacenterKind)}
              disabled={mutation.isPending}
              className="h-8 text-xs"
            >
              <NativeSelectOption value="primary">生产主中心 (Primary)</NativeSelectOption>
              <NativeSelectOption value="metro_dr">同城双活/灾备中心 (Metro DR)</NativeSelectOption>
              <NativeSelectOption value="remote_dr">异地容灾中心 (Remote DR)</NativeSelectOption>
            </NativeSelect>
          </Field>

          <Field>
            <FieldLabel className="text-xs">物理园区详细地址</FieldLabel>
            <Input
              placeholder="如: 北京市大兴区经济技术开发区经海路xx号"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={mutation.isPending}
              className="h-8 text-xs"
            />
          </Field>

          <Field>
            <FieldLabel className="text-xs">备注与描述</FieldLabel>
            <Textarea
              placeholder="电力容量、总建筑面积及运营商专线说明..."
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
              onClick={() => void requestClose()}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存更改" : "创建数据中心"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
