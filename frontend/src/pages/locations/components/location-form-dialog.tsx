import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Loader2 } from "lucide-react"
import { z } from "zod"
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
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { newManagedIdempotencyKey } from "@/services/managed"
import {
  locationsService,
  type DatacenterContact,
  type LocationNode,
  type LocationType,
} from "@/services/locations"
import { locationTypeLabels } from "./location-tree"

const ROW_PATTERN = /^(?:[A-Za-z]|[1-9]|1[0-9]|2[0-5])$/

type LocationFormValues = {
  name: string
  address: string
  contactName: string
  contactPhone: string
  contactEmail: string
  floor: string
  row: string
  column: string
  heightU: string
  powerW: string
}

const createLocationSchema = (type: LocationType) => {
  const base = {
    name: z
      .string()
      .trim()
      .min(1, "名称必须在 1 到 128 个字符之间")
      .max(128, "名称必须在 1 到 128 个字符之间"),
  }

  if (type === "datacenter") {
    return z.object({
      ...base,
      address: z
        .string()
        .trim()
        .min(1, "地址必须在 1 到 512 个字符之间")
        .max(512, "地址必须在 1 到 512 个字符之间"),
      contactName: z
        .string()
        .trim()
        .min(1, "联系人姓名必须在 1 到 128 个字符之间")
        .max(128, "联系人姓名必须在 1 到 128 个字符之间"),
      contactPhone: z.string().trim().max(64, "联系人电话不能超过 64 个字符"),
      contactEmail: z
        .string()
        .trim()
        .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), "请输入合法的邮箱地址"),
      floor: z.string(),
      row: z.string(),
      column: z.string(),
      heightU: z.string(),
      powerW: z.string(),
    })
  }

  if (type === "room") {
    return z.object({
      ...base,
      address: z.string(),
      contactName: z.string(),
      contactPhone: z.string(),
      contactEmail: z.string(),
      floor: z
        .string()
        .trim()
        .refine((val) => {
          const num = Number(val)
          return val !== "" && Number.isInteger(num) && num >= -5 && num <= 100
        }, "楼层必须为 -5 到 100 之间的整数"),
      row: z.string(),
      column: z.string(),
      heightU: z.string(),
      powerW: z.string(),
    })
  }

  if (type === "rack") {
    return z.object({
      ...base,
      address: z.string(),
      contactName: z.string(),
      contactPhone: z.string(),
      contactEmail: z.string(),
      floor: z.string(),
      row: z
        .string()
        .trim()
        .toUpperCase()
        .refine((val) => ROW_PATTERN.test(val), "机柜行必须为 A–Z 或 1–25"),
      column: z
        .string()
        .trim()
        .refine((val) => {
          const num = Number(val)
          return Number.isInteger(num) && num >= 1 && num <= 9999
        }, "机柜列必须为 1 到 9999 之间的整数"),
      heightU: z
        .string()
        .trim()
        .refine((val) => {
          const num = Number(val)
          return Number.isInteger(num) && num >= 1 && num <= 100
        }, "机柜高度必须为 1 到 100 U 之间的整数"),
      powerW: z
        .string()
        .trim()
        .refine((val) => {
          if (!val) return true
          const num = Number(val)
          return Number.isInteger(num) && num > 0
        }, "承载功率必须为大于 0 的整数（瓦特 W）"),
    })
  }

  // building
  return z.object({
    ...base,
    address: z.string(),
    contactName: z.string(),
    contactPhone: z.string(),
    contactEmail: z.string(),
    floor: z.string(),
    row: z.string(),
    column: z.string(),
    heightU: z.string(),
    powerW: z.string(),
  })
}

interface LocationFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node?: LocationNode | null
  type: LocationType
  parent?: LocationNode | null
  onSuccess?: (saved: LocationNode) => void
}

export function LocationFormDialog({
  open,
  onOpenChange,
  node,
  type,
  parent,
  onSuccess,
}: LocationFormDialogProps) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const isEditing = Boolean(node)

  const locationSchema = useMemo(() => createLocationSchema(type), [type])

  const defaultValues = useMemo<LocationFormValues>(() => {
    if (node) {
      const ext = (node.ext ?? {}) as Record<string, any>
      const contact = (ext.contact ?? {}) as DatacenterContact
      return {
        name: node.name ?? "",
        address: String(ext.address ?? ""),
        contactName: String(contact.name ?? ""),
        contactPhone: String(contact.phone ?? ""),
        contactEmail: String(contact.email ?? ""),
        floor: ext.floor != null ? String(ext.floor) : "1",
        row: String(ext.row ?? "A"),
        column: ext.column != null ? String(ext.column) : "1",
        heightU: ext.height_u != null ? String(ext.height_u) : "42",
        powerW: ext.power_capacity_w != null ? String(ext.power_capacity_w) : "",
      }
    }
    return {
      name: "",
      address: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      floor: "1",
      row: "A",
      column: "1",
      heightU: "42",
      powerW: "",
    }
  }, [node])

  const mutation = useMutation({
    mutationFn: async (values: LocationFormValues) => {
      let extPayload: Record<string, unknown> = {}
      if (type === "datacenter") {
        extPayload = {
          address: values.address.trim(),
          contact: {
            name: values.contactName.trim(),
            phone: values.contactPhone.trim() || undefined,
            email: values.contactEmail.trim() || undefined,
          },
        }
      } else if (type === "building") {
        extPayload = {}
      } else if (type === "room") {
        extPayload = {
          floor: Number(values.floor),
        }
      } else if (type === "rack") {
        const upperRow = values.row.trim().toUpperCase()
        extPayload = {
          row: upperRow,
          column: Number(values.column),
          height_u: Number(values.heightU),
          power_capacity_w: values.powerW.trim() ? Number(values.powerW) : null,
        }
      }

      if (isEditing && node) {
        const res = await locationsService.update(node.uid, {
          name: values.name.trim(),
          ext: extPayload,
          version: node.version,
        })
        return res.data
      }

      const res = await locationsService.create(
        {
          name: values.name.trim(),
          type,
          parent: parent?.uid ?? null,
          ext: extPayload,
        },
        newManagedIdempotencyKey(),
      )
      return res.data
    },
    onSuccess: (saved) => {
      notify.success(
        isEditing
          ? `${locationTypeLabels[type]}已更新`
          : `已新建${locationTypeLabels[type]}「${saved.name}」`,
      )
      void queryClient.invalidateQueries({ queryKey: ["location-nodes"] })
      onSuccess?.(saved)
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<LocationFormValues>({
    defaultValues,
    resetKey: node?.uid ?? `create:${type}:${parent?.uid ?? ""}`,
    schema: locationSchema,
    serverFieldNames: {
      "ext.address": "address",
      "ext.contact.name": "contactName",
      "ext.contact.phone": "contactPhone",
      "ext.contact.email": "contactEmail",
      "ext.floor": "floor",
      "ext.row": "row",
      "ext.column": "column",
      "ext.height_u": "heightU",
      "ext.power_capacity_w": "powerW",
    },
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: `${isEditing ? "保存" : "创建"}${locationTypeLabels[type]}失败`,
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "位置表单尚未保存，关闭后更改将丢失。")

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

  const titleText = isEditing
    ? `编辑${locationTypeLabels[type]}`
    : `新建${locationTypeLabels[type]}`

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void requestClose()
        else onOpenChange(true)
      }}
    >
      <DialogContent className="max-w-lg sm:max-w-lg">
        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{titleText}</DialogTitle>
            <DialogDescription>
              {isEditing ? (
                <>编辑当前位置节点的属性（类型与上级归属在创建后固定）。</>
              ) : parent ? (
                <>
                  在「{parent.name}」({locationTypeLabels[parent.type]}) 下创建新的
                  {locationTypeLabels[type]}。
                </>
              ) : (
                <>创建顶层{locationTypeLabels[type]}。</>
              )}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertCircle className="size-4" />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="space-y-3">
            <form.Field name="name">
              {(field) => (
                <FormField
                  field={field}
                  label={`${locationTypeLabels[type]}名称`}
                  required
                  description="同级名称不可重复，最多 128 个字符"
                  idPrefix="location"
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder={`请输入${locationTypeLabels[type]}名称`}
                      maxLength={128}
                      disabled={mutation.isPending}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            {type === "datacenter" && (
              <>
                <form.Field name="address">
                  {(field) => (
                    <FormField
                      field={field}
                      label="机房物理地址"
                      required
                      description="详细物理位置，用于运维及巡检调度"
                      idPrefix="location"
                    >
                      {(props) => (
                        <Input
                          {...props}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          placeholder="例如：北京市海淀区中关村南大街 1 号"
                          maxLength={512}
                          disabled={mutation.isPending}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <form.Field name="contactName">
                    {(field) => (
                      <FormField
                        field={field}
                        label="中心现场联系人"
                        required
                        idPrefix="location"
                      >
                        {(props) => (
                          <Input
                            {...props}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="例如：张工"
                            maxLength={128}
                            disabled={mutation.isPending}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>

                  <form.Field name="contactPhone">
                    {(field) => (
                      <FormField
                        field={field}
                        label="联系电话"
                        idPrefix="location"
                      >
                        {(props) => (
                          <Input
                            {...props}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="手机或值班座机"
                            maxLength={64}
                            disabled={mutation.isPending}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>
                </div>

                <form.Field name="contactEmail">
                  {(field) => (
                    <FormField
                      field={field}
                      label="联系邮箱"
                      description="接收现场工单与告警通知的联络邮箱"
                      idPrefix="location"
                    >
                      {(props) => (
                        <Input
                          {...props}
                          type="email"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          placeholder="noc@example.com"
                          maxLength={254}
                          disabled={mutation.isPending}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
              </>
            )}

            {type === "building" && (
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                楼栋节点无需额外扩展字段，仅需填写规范的楼栋名称。
              </div>
            )}

            {type === "room" && (
              <form.Field name="floor">
                {(field) => (
                  <FormField
                    field={field}
                    label="所在楼层"
                    required
                    description="整数：-5 到 100（正数表示地上楼层如 3F，负数表示地下楼层如 -1 表示 B1F）"
                    idPrefix="location"
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        min={-5}
                        max={100}
                        step={1}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="3"
                        disabled={mutation.isPending}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            )}

            {type === "rack" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <form.Field name="row">
                    {(field) => (
                      <FormField
                        field={field}
                        label="机柜排/行 (Row)"
                        required
                        description="单字母 A–Z 或数字 1–25"
                        idPrefix="location"
                      >
                        {(props) => (
                          <Input
                            {...props}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
                            onBlur={field.handleBlur}
                            placeholder="A 或 1"
                            maxLength={2}
                            disabled={mutation.isPending}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>

                  <form.Field name="column">
                    {(field) => (
                      <FormField
                        field={field}
                        label="机柜列号 (Column)"
                        required
                        description="1 到 9999 之间的列号"
                        idPrefix="location"
                      >
                        {(props) => (
                          <Input
                            {...props}
                            type="number"
                            min={1}
                            max={9999}
                            step={1}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="1"
                            disabled={mutation.isPending}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <form.Field name="heightU">
                    {(field) => (
                      <FormField
                        field={field}
                        label="机柜高度 (U)"
                        required
                        description="标准机柜通常为 42U（范围 1–100U）"
                        idPrefix="location"
                      >
                        {(props) => (
                          <Input
                            {...props}
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="42"
                            disabled={mutation.isPending}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>

                  <form.Field name="powerW">
                    {(field) => (
                      <FormField
                        field={field}
                        label="设计承载功率 (W)"
                        description={
                          field.state.value
                            ? `${(Number(field.state.value) / 1000).toFixed(2)} kW`
                            : "可选整数（瓦特），如 8000 W = 8 kW"
                        }
                        idPrefix="location"
                      >
                        {(props) => (
                          <Input
                            {...props}
                            type="number"
                            min={1}
                            step={1}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="8000"
                            disabled={mutation.isPending}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>
                </div>
              </div>
            )}
          </FieldGroup>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestClose()}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting]}>
              {([isSubmitting]) => (
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  {(isSubmitting || mutation.isPending) && (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  )}
                  {isEditing ? "保存变更" : "确认创建"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
