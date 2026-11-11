import { useId, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/common/confirm-dialog"
import { QueryErrorState } from "@/components/common/query-error-state"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { useAuth } from "@/stores/auth-context"
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
  source,
  value,
  onChange,
  label,
  disabled,
  required,
}: {
  id: string
  source: ManagedLookupSource
  value: string
  onChange: (value: string) => void
  label: string
  disabled?: boolean
  required?: boolean
}) {
  const { can } = useAuth()
  const canRead = can(source.permission)
  const [search, setSearch] = useState("")
  const term = useDebouncedValue(search.trim(), 250)
  const [selected, setSelected] = useState<LookupRow>()
  const query = useQuery({
    queryKey: [source.key, "lookup", term],
    queryFn: ({ signal }) => source.list({ search: term, page_size: 50, status: 1 }, signal),
    enabled: canRead,
  })
  const items = query.data?.data.items ?? []
  const currentOption = value && !items.some((item) => item.id === value)
  return (
    <div className="space-y-1.5">
      {canRead && (
        <Input
          type="search"
          aria-label={`搜索${label}`}
          placeholder={`按名称或编码搜索${label}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={disabled}
        />
      )}
      <NativeSelect
        id={id}
        className="w-full"
        required={required}
        value={value}
        onChange={(event) => {
          const next = event.target.value
          setSelected(items.find((item) => item.id === next))
          onChange(next)
        }}
        disabled={disabled || !canRead || query.isLoading}
      >
        <NativeSelectOption value="">
          {query.isLoading ? "加载中…" : `选择${label}`}
        </NativeSelectOption>
        {currentOption && (
          <NativeSelectOption value={value}>
            {selected?.id === value ? selected.name : `当前已选${label}`}
          </NativeSelectOption>
        )}
        {items.map((item) => (
          <NativeSelectOption key={item.id} value={item.id}>
            {item.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {!canRead && <p className="text-xs text-muted-foreground">没有查询{label}的权限</p>}
      {query.error && (
        <QueryErrorState label={label} error={query.error} onRetry={() => void query.refetch()} />
      )}
      {canRead && query.isSuccess && items.length === 0 && !currentOption && (
        <p className="text-xs text-muted-foreground">没有可选的{label}</p>
      )}
      {canRead && (query.data?.data.total ?? 0) > items.length && (
        <p className="text-xs text-muted-foreground">请缩小搜索范围以查看其余结果</p>
      )}
    </div>
  )
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
  const [draft, setDraft] = useState<Record<string, string | boolean>>({})
  const dirty = Object.keys(draft).length > 0
  useUnsavedChanges(dirty, "关闭后将丢失未保存的更改。")
  const mutation = useMutation({
    mutationFn: save,
    onSuccess: () => {
      notify.success(record ? "已保存更改" : "已创建记录", title)
      onClose()
    },
  })
  const schema: EditorField<T>[] = [
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
  ]
  const valueOf = (key: string) => draft[key] ?? (record as Record<string, unknown> | null)?.[key]
  const close = async () => {
    if (mutation.isPending) return
    if (
      dirty &&
      !(await confirm({
        title: "放弃更改？",
        description: "关闭后将丢失未保存的更改。",
        confirmText: "放弃更改",
      }))
    )
      return
    onClose()
  }
  const submit = () => {
    const values: Record<string, unknown> = {}
    for (const field of schema) {
      const value = valueOf(field.key)
      if (field.type === "checkbox") values[field.key] = Boolean(value)
      else if (field.type === "number")
        values[field.key] = value === "" || value == null ? undefined : Number(value)
      else values[field.key] = String(value ?? "").trim()
    }
    if (typeof draft.description === "string") values.description = draft.description.trim()
    mutation.mutate(values as Partial<T>)
  }
  const missing = schema.some((field) => field.required && !String(valueOf(field.key) ?? "").trim())
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close()
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {record ? "编辑" : "新建"}
            {title}
          </DialogTitle>
          <DialogDescription>填写档案信息后保存。</DialogDescription>
        </DialogHeader>
        {mutation.error && (
          <Alert variant="destructive">
            <AlertDescription>{getErrorMessage(mutation.error)}</AlertDescription>
          </Alert>
        )}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!missing && !mutation.isPending) submit()
          }}
        >
          {schema.map((field) => {
            const id = `${uid}-${field.key}`
            const value = valueOf(field.key)
            const set = (next: string | boolean) =>
              setDraft((current) => ({ ...current, [field.key]: next }))
            const disabled = mutation.isPending || (field.key === "code" && Boolean(record))
            return (
              <Field key={field.key}>
                <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                {field.type === "lookup" ? (
                  <ManagedLookup
                    id={id}
                    source={field.source}
                    value={String(value ?? "")}
                    onChange={set}
                    label={field.label}
                    disabled={disabled}
                    required={field.required}
                  />
                ) : field.type === "checkbox" ? (
                  <Checkbox
                    id={id}
                    checked={Boolean(value)}
                    onCheckedChange={set}
                    disabled={disabled}
                  />
                ) : field.type === "select" ? (
                  <NativeSelect
                    id={id}
                    required={field.required}
                    value={String(value ?? "")}
                    onChange={(event) => set(event.target.value)}
                    disabled={disabled}
                  >
                    <NativeSelectOption value="">请选择</NativeSelectOption>
                    {field.options.map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    id={id}
                    required={field.required}
                    type={field.type}
                    value={String(value ?? "")}
                    onChange={(event) => set(event.target.value)}
                    min={field.type === "number" ? field.min : undefined}
                    max={field.type === "number" ? field.max : undefined}
                    maxLength={field.type === "text" ? field.maxLength : undefined}
                    disabled={disabled}
                  />
                )}
              </Field>
            )
          })}
          <Field>
            <FieldLabel htmlFor={`${uid}-description`}>说明</FieldLabel>
            <Textarea
              id={`${uid}-description`}
              maxLength={1024}
              disabled={mutation.isPending}
              value={String(valueOf("description") ?? "")}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void close()}
            >
              取消
            </Button>
            <Button type="submit" disabled={missing || mutation.isPending}>
              {mutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
