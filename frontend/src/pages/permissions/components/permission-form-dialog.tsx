import { useEffect, useMemo, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Info, MousePointerClick, PanelsTopLeft, Webhook } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { collectIds, findNode } from "@/lib/tree"
import { permissionsService, type PermissionDTO, type PermissionType } from "@/services/permissions"

const ROOT = "__root__"
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "*"] as const

function flattenWithDepth(nodes: PermissionDTO[], depth = 0): Array<{ node: PermissionDTO; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenWithDepth(node.children ?? [], depth + 1)])
}

const basePermissionFields = {
  parentId: z.string(),
  name: z
    .string()
    .trim()
    .min(1, "权限点名称不能为空")
    .max(64, "权限点名称不能超过 64 个字符"),
  code: z
    .string()
    .trim()
    .min(2, "权限编码至少 2 个字符")
    .max(128, "权限编码不能超过 128 个字符"),
  sortOrder: z
    .string()
    .trim()
    .refine((val) => {
      if (!val) return false
      const num = Number(val)
      return Number.isInteger(num) && num >= 0 && num <= 100000
    }, "排序值必须为 0-100000 的整数"),
}

const permissionSchema = z.discriminatedUnion("type", [
  z.object({
    ...basePermissionFields,
    type: z.literal("menu"),
    path: z
      .string()
      .trim()
      .max(255, "前端路由不能超过 255 个字符")
      .refine((v) => v === "" || v.startsWith("/"), "前端路由若填写需以 / 开头"),
    method: z.string(),
    icon: z.string().trim().max(64, "图标名称不能超过 64 个字符"),
  }),
  z.object({
    ...basePermissionFields,
    type: z.literal("button"),
    path: z.string(),
    method: z.string(),
    icon: z.string(),
  }),
  z.object({
    ...basePermissionFields,
    type: z.literal("api"),
    path: z
      .string()
      .trim()
      .min(1, "接口路径不能为空")
      .max(255, "接口路径不能超过 255 个字符")
      .refine((v) => v.startsWith("/"), "接口路径必须以 / 开头"),
    method: z
      .string()
      .refine((v) => (METHODS as readonly string[]).includes(v), "请选择有效的 HTTP 方法"),
    icon: z.string(),
  }),
])

type PermissionFormValues = z.infer<typeof permissionSchema>

export type PermissionFormState = { mode: "create"; parentId: string | null } | { mode: "edit"; permission: PermissionDTO } | null

export function PermissionFormDialog({
  state,
  tree,
  onOpenChange,
}: {
  state: PermissionFormState
  tree: PermissionDTO[]
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = state?.mode === "edit" ? state.permission : null
  const locked = !!editing?.built_in
  const codeTouchedRef = useRef(false)

  const defaultValues = useMemo<PermissionFormValues>(() => {
    if (!state) {
      return {
        parentId: ROOT,
        type: "menu",
        name: "",
        code: "",
        path: "",
        method: "GET",
        icon: "",
        sortOrder: "0",
      }
    }
    const p = state.mode === "edit" ? state.permission : null
    const parent = state.mode === "create" ? state.parentId : (p?.parent_id ?? null)
    const parentNode = parent ? findNode(tree, parent) : undefined
    codeTouchedRef.current = !!p

    return {
      parentId: parent ?? ROOT,
      type: (p?.type ?? (parentNode?.type === "button" ? "api" : parentNode ? "button" : "menu")) as PermissionType,
      name: p?.name ?? "",
      code: p?.code ?? "",
      path: p?.path ?? "",
      method: p?.method || "GET",
      icon: p?.icon ?? "",
      sortOrder: String(p?.sort_order ?? 0),
    }
  }, [state, tree])

  const blocked = useMemo(() => new Set(editing ? collectIds(editing) : []), [editing])
  const parentOptions = useMemo(
    () => flattenWithDepth(tree).filter(({ node }) => node.type !== "api" && !blocked.has(node.id)),
    [tree, blocked],
  )
  const parentItems = useMemo(
    () => [
      { value: ROOT, label: "无（顶级节点）" },
      ...parentOptions.map(({ node, depth }) => ({ value: node.id, label: `${"　".repeat(depth)}${node.name}` })),
    ],
    [parentOptions],
  )

  const mutation = useMutation({
    mutationFn: (values: PermissionFormValues) => {
      const payload = {
        parent_id: values.parentId === ROOT ? null : values.parentId,
        type: values.type,
        name: values.name.trim(),
        code: values.code.trim(),
        path: values.type === "button" ? "" : values.path.trim(),
        method: values.type === "api" ? values.method : "",
        icon: values.type === "menu" ? values.icon.trim() : "",
        sort_order: Number(values.sortOrder) || 0,
      }
      return editing ? permissionsService.update(editing.id, payload) : permissionsService.create(payload)
    },
    onSuccess: (res) => {
      notify.success(editing ? "权限点已更新" : "权限点已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["permissions"] })
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, clearErrors, hasChanges } = useAppForm<PermissionFormValues>({
    defaultValues,
    resetKey:
      state?.mode === "edit"
        ? state.permission.id
        : state?.mode === "create"
          ? `create:${state.parentId ?? ""}`
          : undefined,
    schema: permissionSchema,
    serverFieldNames: {
      parent_id: "parentId",
      sort_order: "sortOrder",
    },
    open: Boolean(state),
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: "保存失败",
  })

  const isDirty = Boolean(state) && hasChanges
  useUnsavedChanges(isDirty, "权限点表单尚未保存。离开后这些更改将丢失。")

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃权限点更改？",
        description: "当前表单尚未保存，离开后这些更改将丢失。",
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={!!state} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑权限点" : "新建权限点"}</DialogTitle>
          <DialogDescription>菜单控制导航可见性，按钮控制界面操作，接口由服务端在每次请求时强制鉴权</DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
        >
          {formError && (
            <Alert variant="destructive">
              <Info />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {locked && (
            <Alert>
              <Info />
              <AlertDescription>内置权限点与系统路由绑定，仅可修改名称、图标与排序。</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-4">
            <form.Field name="type">
              {(field) => (
                <FormField field={field} label="节点类型" id="perm-type" idPrefix="perm">
                  {() => (
                    <ToggleGroup
                      variant="outline"
                      value={[field.state.value]}
                      onValueChange={(v) => {
                        const nextType = v[0] as PermissionType | undefined
                        if (!nextType || nextType === field.state.value) return
                        clearErrors()
                        field.handleChange(nextType)
                      }}
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
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="parentId">
              {(field) => (
                <FormField field={field} label="上级节点" id="perm-parent" idPrefix="perm">
                  {(inputProps) => (
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(String(v))}
                      items={parentItems}
                      disabled={locked}
                    >
                      <SelectTrigger
                        id={inputProps.id}
                        aria-invalid={inputProps["aria-invalid"]}
                        aria-describedby={inputProps["aria-describedby"]}
                        className="w-full"
                      >
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
                  )}
                </FormField>
              )}
            </form.Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="name">
                {(field) => (
                  <FormField field={field} label="名称" required idPrefix="perm">
                    {(props) => (
                      <Input
                        {...props}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="如 导出报表"
                      />
                    )}
                  </FormField>
                )}
              </form.Field>

              <form.Field name="code">
                {(field) => (
                  <FormField field={field} label="权限编码" required idPrefix="perm">
                    {(props) => (
                      <Input
                        {...props}
                        value={field.state.value}
                        onChange={(e) => {
                          field.handleChange(e.target.value)
                          codeTouchedRef.current = true
                        }}
                        onBlur={field.handleBlur}
                        placeholder="如 reports:export"
                        className="font-mono"
                        disabled={locked}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            </div>

            <form.Subscribe selector={(state) => [state.values.type]}>
              {([currentType]) =>
                currentType !== "button" ? (
                  <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                    <form.Field name="path">
                      {(field) => (
                        <FormField
                          field={field}
                          label={currentType === "api" ? "接口路径" : "前端路由"}
                          description={currentType === "api" ? "路径参数示例：/users/:id" : undefined}
                          required={currentType === "api"}
                          idPrefix="perm"
                        >
                          {(props) => (
                            <Input
                              {...props}
                              value={field.state.value}
                              onChange={(e) => {
                                const val = e.target.value
                                field.handleChange(val)
                                if (!codeTouchedRef.current && currentType === "api" && val) {
                                  const curMethod = form.getFieldValue("method")
                                  form.setFieldValue("code", `api:${curMethod}:${val}`)
                                }
                              }}
                              onBlur={field.handleBlur}
                              placeholder={currentType === "api" ? "/api/v1/reports/:id" : "/reports"}
                              className="font-mono"
                              disabled={locked}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>

                    {currentType === "api" && (
                      <form.Field name="method">
                        {(field) => (
                          <FormField field={field} label="HTTP 方法" id="perm-method" idPrefix="perm" required>
                            {(inputProps) => (
                              <Select
                                value={field.state.value}
                                onValueChange={(v) => {
                                  field.handleChange(String(v))
                                  if (!codeTouchedRef.current) {
                                    const curPath = form.getFieldValue("path")
                                    if (curPath) {
                                      form.setFieldValue("code", `api:${v}:${curPath}`)
                                    }
                                  }
                                }}
                                disabled={locked}
                              >
                                <SelectTrigger
                                  id={inputProps.id}
                                  aria-invalid={inputProps["aria-invalid"]}
                                  aria-describedby={inputProps["aria-describedby"]}
                                  className="w-full font-mono"
                                >
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
                            )}
                          </FormField>
                        )}
                      </form.Field>
                    )}
                  </div>
                ) : null
              }
            </form.Subscribe>

            <form.Subscribe selector={(state) => [state.values.type]}>
              {([currentType]) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  {currentType === "menu" && (
                    <form.Field name="icon">
                      {(field) => (
                        <FormField field={field} label="图标" idPrefix="perm">
                          {(props) => (
                            <Input
                              {...props}
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder="lucide 图标名，如 BarChart3"
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                  )}

                  <form.Field name="sortOrder">
                    {(field) => (
                      <FormField field={field} label="排序值" idPrefix="perm">
                        {(props) => (
                          <Input
                            {...props}
                            type="number"
                            min={0}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>
                </div>
              )}
            </form.Subscribe>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting]}>
              {([isSubmitting]) => (
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  {(isSubmitting || mutation.isPending) && <Spinner />}
                  {editing ? "保存修改" : "创建权限点"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
