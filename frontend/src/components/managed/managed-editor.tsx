import { useEffect, useId, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/common/confirm-dialog"
import { QueryErrorState } from "@/components/common/query-error-state"
import { FormField, useAppForm } from "@/components/form"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorStatus } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { useAuth } from "@/stores/auth-context"
import { cn } from "@/lib/utils"
import type { ManagedBase, ManagedQueryParams } from "@/services/managed"
import type { Envelope, PageData } from "@/services/types"

type LookupRow = Pick<ManagedBase, "id" | "name">
export interface ManagedLookupSource {
  key: string
  permission: string
  list: (params: ManagedQueryParams, signal: AbortSignal) => Promise<Envelope<PageData<LookupRow>>>
}

export type EditorField<T> = {
  key: Extract<keyof T, string>
  label: string
  required?: boolean
} & (
  | { type: "text" | "date"; maxLength?: number }
  | { type: "number"; min?: number; max?: number }
  | { type: "checkbox" }
  | { type: "select"; options: readonly { value: string; label: string }[] }
  | { type: "lookup"; source: ManagedLookupSource }
)

export function ManagedLookup({
  id,
  triggerId = `${id}-trigger`,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  source,
  value,
  onChange,
  label,
  disabled,
  required,
  className,
}: {
  id: string
  triggerId?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  source: ManagedLookupSource
  value: string
  onChange: (value: string) => void
  label: string
  disabled?: boolean
  required?: boolean
  className?: string
}) {
  const { can } = useAuth()
  const canRead = can(source.permission)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const term = useDebouncedValue(search.trim(), 250)
  const [selected, setSelected] = useState<LookupRow>()

  const query = useQuery({
    queryKey: [source.key, "lookup", term],
    queryFn: ({ signal }) => source.list({ search: term, page_size: 50, status: 1 }, signal),
    enabled: canRead,
  })

  const items = query.data?.data.items ?? []

  useEffect(() => {
    if (value && items.length > 0) {
      const match = items.find((item) => item.id === value)
      if (match) setSelected(match)
    }
  }, [value, items])

  const forbidden = !canRead || getErrorStatus(query.error) === 403
  const displayText =
    (selected?.id === value ? selected?.name : undefined) ||
    (value ? items.find((i) => i.id === value)?.name ?? "已选择" : "")

  return (
    <div className={cn("relative w-full", className)}>
      {/* 隐藏原生 select：保留表单字段定义与自动化测试 (如 Playwright selectOption) 无缝兼容 */}
      <select
        id={id}
        name={id}
        value={value}
        disabled={disabled || forbidden}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={label}
        className="sr-only pointer-events-none absolute -z-10 opacity-0"
        onChange={(event) => {
          const next = event.target.value
          const match = items.find((item) => item.id === next)
          setSelected(match)
          onChange(next)
        }}
      >
        <option value="">{`选择${label}`}</option>
        {value && !items.some((item) => item.id === value) && (
          <option value={value}>{displayText || value}</option>
        )}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>

      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative w-full">
          <PopoverTrigger
            render={
              <Button
                id={triggerId}
                aria-invalid={ariaInvalid}
                aria-describedby={ariaDescribedBy}
                type="button"
                variant="outline"
                disabled={disabled || forbidden}
                className={cn(
                  "w-full justify-between font-normal text-xs h-8 pl-2.5 pr-8",
                  !displayText && "text-muted-foreground",
                  ariaInvalid && "border-destructive text-destructive ring-destructive/20",
                )}
                aria-label={label}
              >
                <span className="truncate">{displayText || `选择${label}…`}</span>
                <ChevronsUpDown className="size-3.5 opacity-50 shrink-0 absolute right-2.5 top-2.5" />
              </Button>
            }
          />

          {value && !disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-7 top-1 h-6 w-6 text-muted-foreground hover:text-foreground z-10"
              onClick={(e) => {
                e.stopPropagation()
                setSelected(undefined)
                onChange("")
              }}
              aria-label={`清除已选${label}`}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>

        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-(--anchor-width) min-w-64 p-0 shadow-lg"
        >
          <Command shouldFilter={false} className="w-full">
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={`按名称或编码搜索${label}…`}
              className="text-xs"
            />
            <CommandList className="max-h-60 p-1">
              {query.isLoading && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  正在加载…
                </div>
              )}

              {!query.isLoading && forbidden && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  没有查询{label}的权限
                </div>
              )}

              {!query.isLoading && !forbidden && query.error && (
                <div className="p-2">
                  <QueryErrorState
                    label={label}
                    error={query.error}
                    onRetry={() => void query.refetch()}
                  />
                </div>
              )}

              {!query.isLoading && !forbidden && !query.error && items.length === 0 && (
                <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
                  未找到匹配的{label}
                </CommandEmpty>
              )}

              {!query.isLoading && !forbidden && !query.error && items.length > 0 && (
                <CommandGroup>
                  {items.map((item) => {
                    const isSelected = item.id === value
                    return (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        data-checked={isSelected}
                        onSelect={() => {
                          setSelected(item)
                          onChange(item.id)
                          setOpen(false)
                        }}
                        className="flex items-center justify-between py-1.5 text-xs cursor-pointer"
                      >
                        <span className="truncate">{item.name}</span>
                        {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}

              {canRead && (query.data?.data.total ?? 0) > items.length && (
                <div className="border-t border-border/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  共有 {query.data?.data.total} 项，请进一步输入关键词精确筛选
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function createManagedSchema<T extends ManagedBase>(
  schemaFields: readonly EditorField<T>[],
  editing: boolean,
) {
  const shape: Record<string, z.ZodTypeAny> = {
    code: editing
      ? z.string().default("")
      : z
          .string()
          .trim()
          .min(1, "编码不能为空")
          .max(64, "编码不能超过 64 个字符"),
    name: z
      .string()
      .trim()
      .min(1, "名称不能为空")
      .max(128, "名称不能超过 128 个字符"),
    description: z
      .string()
      .max(1024, "说明不能超过 1024 个字符")
      .default(""),
  }

  for (const field of schemaFields) {
    if (field.key === "code" || field.key === "name" || field.key === "description") continue

    if (field.type === "checkbox") {
      shape[field.key] = z.boolean().default(false)
    } else if (field.type === "number") {
      let numSchema = z.string().trim()
      if (field.required) {
        numSchema = numSchema.min(1, `${field.label}不能为空`)
      }
      shape[field.key] = numSchema
        .refine(
          (val) => {
            if (!val) return !field.required
            const n = Number(val)
            if (Number.isNaN(n)) return false
            if (field.min !== undefined && n < field.min) return false
            if (field.max !== undefined && n > field.max) return false
            return true
          },
          {
            message:
              field.min !== undefined && field.max !== undefined
                ? `${field.label}必须在 ${field.min} 至 ${field.max} 之间`
                : field.min !== undefined
                  ? `${field.label}不能小于 ${field.min}`
                  : field.max !== undefined
                    ? `${field.label}不能大于 ${field.max}`
                    : `${field.label}必须为有效数字`,
          },
        )
        .default("")
    } else {
      let strSchema = z.string().trim()
      if (field.required) {
        strSchema = strSchema.min(1, `${field.label}不能为空`)
      }
      if (field.type === "text" && field.maxLength) {
        strSchema = strSchema.max(field.maxLength, `${field.label}不能超过 ${field.maxLength} 个字符`)
      }
      shape[field.key] = strSchema.default("")
    }
  }

  return z.object(shape)
}

export function ManagedEditor<T extends ManagedBase>({
  title,
  record,
  fields,
  save,
  onClose,
}: {
  title: string
  record: T | null
  fields: readonly EditorField<T>[]
  save: (changes: Partial<T>) => Promise<Envelope<T>>
  onClose: () => void
}) {
  const uid = useId()
  const confirm = useConfirm()
  const editing = Boolean(record)

  const schemaFields = useMemo<EditorField<T>[]>(
    () => [
      {
        key: "code" as EditorField<T>["key"],
        label: "编码",
        type: "text",
        required: true,
        maxLength: 64,
      },
      {
        key: "name" as EditorField<T>["key"],
        label: "名称",
        type: "text",
        required: true,
        maxLength: 128,
      },
      ...fields,
    ],
    [fields],
  )

  const defaultValues = useMemo<Record<string, any>>(() => {
    const initial: Record<string, any> = {
      code: record?.code ?? "",
      name: record?.name ?? "",
      description: record?.description ?? "",
    }
    for (const field of fields) {
      const raw = (record as Record<string, unknown> | null)?.[field.key]
      if (field.type === "checkbox") {
        initial[field.key] = Boolean(raw)
      } else if (field.type === "number") {
        initial[field.key] = raw == null ? "" : String(raw)
      } else {
        initial[field.key] = raw == null ? "" : String(raw)
      }
    }
    return initial
  }, [record, fields])

  const mutation = useMutation({
    mutationFn: save,
    onSuccess: () => {
      notify.success(editing ? "已保存更改" : "已创建记录", title)
      onClose()
    },
  })

  const formSchema = useMemo(
    () => createManagedSchema(schemaFields, editing),
    [schemaFields, editing],
  )

  const { form, formRef, submit, hasChanges, formError } = useAppForm<Record<string, any>>({
    defaultValues,
    resetKey: record?.id ?? "new",
    schema: formSchema,
    open: true,
    onSubmit: async (values) => {
      const submitValues: Record<string, unknown> = {
        name: String(values.name ?? "").trim(),
        description: String(values.description ?? "").trim(),
      }
      if (!editing) {
        submitValues.code = String(values.code ?? "").trim()
      }
      for (const field of fields) {
        const val = values[field.key]
        if (field.type === "checkbox") {
          submitValues[field.key] = Boolean(val)
        } else if (field.type === "number") {
          submitValues[field.key] = val === "" || val == null ? undefined : Number(val)
        } else {
          submitValues[field.key] = String(val ?? "").trim()
        }
      }
      await mutation.mutateAsync(submitValues as Partial<T>)
    },
    fallbackErrorMessage: editing ? "保存更改失败" : "创建记录失败",
  })

  const isDirty = hasChanges
  useUnsavedChanges(isDirty, "关闭后将丢失未保存的更改。")

  const close = async () => {
    if (mutation.isPending) return
    if (
      isDirty &&
      !(await confirm({
        title: "放弃更改？",
        description: "关闭后将丢失未保存的更改。",
        confirmText: "放弃更改",
      }))
    ) {
      return
    }
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(openState) => {
        if (!openState) void close()
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "编辑" : "新建"}
            {title}
          </DialogTitle>
          <DialogDescription>填写档案信息后保存。</DialogDescription>
        </DialogHeader>

        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <form
          ref={formRef}
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
        >
          {schemaFields.map((field) => {
            const disabled = mutation.isPending || (field.key === "code" && editing)
            return (
              <form.Field key={field.key} name={field.key}>
                {(formField) => (
                  <FormField
                    field={formField}
                    label={field.label}
                    required={field.required && (!editing || field.key !== "code")}
                    idPrefix={uid}
                  >
                    {(props) => {
                      if (field.type === "lookup") {
                        return (
                          <ManagedLookup
                            id={props.id}
                            triggerId={props.id}
                            aria-invalid={props["aria-invalid"]}
                            aria-describedby={props["aria-describedby"]}
                            source={field.source}
                            value={String(formField.state.value ?? "")}
                            onChange={(val) => formField.handleChange(val as any)}
                            label={field.label}
                            disabled={disabled}
                            required={field.required}
                          />
                        )
                      }
                      if (field.type === "checkbox") {
                        return (
                          <div className="flex items-center space-x-2 pt-1">
                            <Checkbox
                              id={props.id}
                              aria-invalid={props["aria-invalid"]}
                              aria-describedby={props["aria-describedby"]}
                              checked={Boolean(formField.state.value)}
                              onCheckedChange={(val) => formField.handleChange(val as any)}
                              disabled={disabled}
                            />
                          </div>
                        )
                      }
                      if (field.type === "select") {
                        return (
                          <NativeSelect
                            {...props}
                            value={String(formField.state.value ?? "")}
                            onChange={(e) => formField.handleChange(e.target.value as any)}
                            onBlur={formField.handleBlur}
                            disabled={disabled}
                          >
                            <NativeSelectOption value="">请选择</NativeSelectOption>
                            {field.options.map((opt) => (
                              <NativeSelectOption key={opt.value} value={opt.value}>
                                {opt.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )
                      }
                      return (
                        <Input
                          {...props}
                          type={field.type}
                          value={String(formField.state.value ?? "")}
                          onChange={(e) => formField.handleChange(e.target.value as any)}
                          onBlur={formField.handleBlur}
                          min={field.type === "number" ? field.min : undefined}
                          max={field.type === "number" ? field.max : undefined}
                          maxLength={field.type === "text" ? field.maxLength : undefined}
                          disabled={disabled}
                        />
                      )
                    }}
                  </FormField>
                )}
              </form.Field>
            )
          })}

          <form.Field name="description">
            {(descField) => (
              <FormField field={descField} label="说明" idPrefix={uid}>
                {(props) => (
                  <Textarea
                    {...props}
                    maxLength={1024}
                    disabled={mutation.isPending}
                    value={String(descField.state.value ?? "")}
                    onChange={(e) => descField.handleChange(e.target.value)}
                    onBlur={descField.handleBlur}
                  />
                )}
              </FormField>
            )}
          </form.Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void close()}
            >
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
