import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Info, ShieldPlus, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { rolesService, type RoleDTO } from "@/services/roles"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

export function RoleFormDialog({ open, role, onOpenChange }: { open: boolean; role?: RoleDTO | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const editing = !!role
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(role?.code ?? "")
    setName(role?.name ?? "")
    setDescription(role?.description ?? "")
    setError("")
  }, [open, role])

  const codeInvalid = !editing && code.length > 0 && !CODE_PATTERN.test(code)
  const canSubmit = name.trim().length >= 2 && (editing || (code.trim().length >= 2 && !codeInvalid))

  const mutation = useMutation({
    mutationFn: () =>
      editing && role
        ? rolesService.update(role.id, { name: name.trim(), description: description.trim() })
        : rolesService.create({ code: code.trim(), name: name.trim(), description: description.trim() }),
    onSuccess: (res) => {
      notify.success(editing ? "角色已更新" : "角色已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      onOpenChange(false)
    },
    onError: (err) => setError(getErrorMessage(err, editing ? "更新角色失败" : "创建角色失败")),
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? <ShieldCheck className="size-4.5 text-primary" /> : <ShieldPlus className="size-4.5 text-primary" />}
            {editing ? "编辑角色" : "新建角色"}
          </DialogTitle>
          <DialogDescription>角色编码是系统唯一的授权主体标识，创建后不可修改</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
        >
          {error && (
            <Alert variant="destructive">
              <Info />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FieldGroup className="gap-4">
            <Field data-invalid={codeInvalid || undefined}>
              <FieldLabel htmlFor="role-code">角色编码</FieldLabel>
              <Input id="role-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 auditor" className="font-mono" disabled={editing} />
              {codeInvalid ? <FieldError>以字母开头，仅含字母、数字及 _ . : -</FieldError> : <FieldDescription>建议使用小写英文，如 operator、auditor</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="role-name">角色名称</FieldLabel>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 审计员" />
            </Field>
            <Field>
              <FieldLabel htmlFor="role-desc">职责描述</FieldLabel>
              <Textarea id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简述该角色的职责范围" rows={3} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {editing ? "保存修改" : "创建角色"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
