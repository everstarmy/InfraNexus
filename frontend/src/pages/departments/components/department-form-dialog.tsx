import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FolderPlus, FolderPen, Info } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { DepartmentSelect, departmentPathLabel } from "@/components/common/department-select"
import { UserPicker } from "@/components/common/user-picker"
import { getErrorMessage, getFieldErrors } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { departmentsService, type DepartmentNode } from "@/services/departments"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

export function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
  parentId,
  departments,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  department?: DepartmentNode | null
  parentId?: string | null
  departments: DepartmentNode[]
  onSaved?: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const editing = !!department
  const [parent, setParent] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [sortOrder, setSortOrder] = useState("0")
  const [leaderId, setLeaderId] = useState<string | null>(null)
  const [leaderLabel, setLeaderLabel] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState("")

  useEffect(() => {
    if (!open) return
    setParent(department ? department.parent_id : (parentId ?? null))
    setName(department?.name ?? "")
    setCode(department?.code ?? "")
    setSortOrder(String(department?.sort_order ?? 0))
    setLeaderId(department?.leader_id ?? null)
    setLeaderLabel(department?.leader_name ?? "")
    setPhone(department?.phone ?? "")
    setEmail(department?.email ?? "")
    setEnabled((department?.status ?? 1) === 1)
    setFieldErrors({})
    setFormError("")
  }, [open, department, parentId])

  const codeInvalid = code.length > 0 && !CODE_PATTERN.test(code)
  const canSubmit = name.trim().length > 0 && code.trim().length >= 2 && !codeInvalid

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        code: code.trim(),
        sort_order: Number(sortOrder) || 0,
        leader_id: leaderId,
        phone: phone.trim(),
        email: email.trim(),
        status: enabled ? 1 : 2,
      }
      if (editing && department) return departmentsService.update(department.id, payload)
      return departmentsService.create({ ...payload, parent_id: parent })
    },
    onSuccess: (res) => {
      notify.success(editing ? "部门已更新" : "部门已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["departments"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      onSaved?.(res.data.id)
      onOpenChange(false)
    },
    onError: (error) => {
      setFieldErrors(getFieldErrors(error))
      setFormError(getErrorMessage(error, editing ? "更新部门失败" : "创建部门失败"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? <FolderPen className="size-4.5 text-primary" /> : <FolderPlus className="size-4.5 text-primary" />}
            {editing ? "编辑部门" : parent ? "新增子部门" : "新建部门"}
          </DialogTitle>
          <DialogDescription>
            {editing ? `部门路径：${departmentPathLabel(departments, department?.id)}` : "部门编码全局唯一，用于系统集成与目录同步映射"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
        >
          {formError && (
            <Alert variant="destructive">
              <Info />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {editing && department?.source === "ldap" && (
            <Alert>
              <Info />
              <AlertDescription>该部门由目录同步自动创建，重命名不会影响同步映射（按 OU 标识匹配）。</AlertDescription>
            </Alert>
          )}
          <FieldGroup className="gap-4">
            {!editing && (
              <Field>
                <FieldLabel htmlFor="dept-parent">上级部门</FieldLabel>
                <DepartmentSelect id="dept-parent" nodes={departments} value={parent} onChange={setParent} placeholder="无（作为顶级部门）" allowClear />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!fieldErrors.name || undefined}>
                <FieldLabel htmlFor="dept-name">部门名称</FieldLabel>
                <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 研发中心" />
              </Field>
              <Field data-invalid={codeInvalid || !!fieldErrors.code || undefined}>
                <FieldLabel htmlFor="dept-code">部门编码</FieldLabel>
                <Input id="dept-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 rd-center" className="font-mono" aria-invalid={codeInvalid || undefined} />
                {codeInvalid && <FieldError>以字母开头，仅含字母、数字及 _ . : -</FieldError>}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="dept-leader">部门负责人</FieldLabel>
              <UserPicker
                id="dept-leader"
                value={leaderId}
                valueLabel={leaderLabel}
                onChange={(id, label) => {
                  setLeaderId(id)
                  setLeaderLabel(label ?? "")
                }}
                placeholder="未指定负责人"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="dept-phone">联系电话</FieldLabel>
                <Input id="dept-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="选填" />
              </Field>
              <Field data-invalid={!!fieldErrors.email || undefined}>
                <FieldLabel htmlFor="dept-email">部门邮箱</FieldLabel>
                <Input id="dept-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="选填" />
                {fieldErrors.email && <FieldError>邮箱格式不正确</FieldError>}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="dept-sort">排序值</FieldLabel>
                <Input id="dept-sort" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
                <FieldDescription>数值越小越靠前</FieldDescription>
              </Field>
              <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-2 sm:mt-6 sm:h-fit">
                <FieldLabel htmlFor="dept-enabled">启用部门</FieldLabel>
                <Switch id="dept-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {editing ? "保存修改" : "创建部门"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
