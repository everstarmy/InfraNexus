import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Server } from "lucide-react"
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
import { racksService, type RackDTO } from "@/services/locations"

export function RackFormDialog({
  open,
  rackRowId,
  rack,
  onOpenChange,
}: {
  open: boolean
  rackRowId: string
  rack?: RackDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const editing = Boolean(rack)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [units, setUnits] = useState("42")
  const [maxLoadKg, setMaxLoadKg] = useState("1000")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(rack?.code ?? "")
    setName(rack?.name ?? "")
    setLabel(rack?.label ?? "")
    setUnits(rack?.units !== undefined ? String(rack.units) : "42")
    setMaxLoadKg(rack?.max_load_kg !== undefined ? String(rack.max_load_kg) : "1000")
    setDescription(rack?.description ?? "")
    setError("")
  }, [open, rack])

  const canSubmit =
    name.trim().length >= 2 &&
    Number(units) >= 1 &&
    Number(units) <= 100 &&
    (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<RackDTO> = {
        rack_row_id: rackRowId,
        name: name.trim(),
        label: label.trim() || undefined,
        units: Number(units),
        max_load_kg: Number(maxLoadKg),
        description: description.trim() || undefined,
      }
      if (editing && rack) {
        return racksService.update(rack, payload)
      }
      return racksService.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(editing ? "机柜已更新" : "机柜已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["racks"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(getErrorMessage(err, editing ? "更新机柜失败" : "创建机柜失败")),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑机柜配置" : "新建服务器机柜"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            设置机柜物理编码、总 U 高容量与最大额定承重
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
              <FieldLabel className="text-xs">机柜编码 (Code) *</FieldLabel>
              <Input
                placeholder="如: rack-a01"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">机柜名称 *</FieldLabel>
              <Input
                placeholder="如: A-01机柜"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
                required
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel className="text-xs">U 位总高 (1~100) *</FieldLabel>
              <Input
                type="number"
                min={1}
                max={100}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">最大承重 (kg) *</FieldLabel>
              <Input
                type="number"
                min={0}
                value={maxLoadKg}
                onChange={(e) => setMaxLoadKg(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">现场物理标签</FieldLabel>
              <Input
                placeholder="如: A-01"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel className="text-xs">备注说明</FieldLabel>
            <Textarea
              placeholder="电源 PDU、冷热通道位置说明..."
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
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存" : "创建机柜"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
