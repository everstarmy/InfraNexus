import { useEffect, useId, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, X } from "lucide-react"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/common/confirm-dialog"
import { QueryErrorState } from "@/components/common/query-error-state"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage, getErrorStatus } from "@/lib/api-error"
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
  source,
  value,
  onChange,
  label,
  disabled,
  required,
  className,
}: {
  id: string
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
      if (match) {
        setSelected(match)
      }
    } else if (!value) {
      setSelected(undefined)
    }
  }, [value, items])

  const forbidden = !canRead || getErrorStatus(query.error) === 403
  const displayText =
    selected?.name ||
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

      {/* 现代 Combobox 交互下拉组件 */}
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative w-full">
          <PopoverTrigger
            render={
              <Button
                id={`${id}-trigger`}
                type="button"
                variant="outline"
                disabled={disabled || forbidden}
                className={cn(
                  "h-8 w-full justify-between px-2.5 text-xs font-normal",
                  !value && "text-muted-foreground",
                  forbidden && "opacity-60 cursor-not-allowed"
                )}
              />
            }
          >
            <span className="truncate">
              {forbidden
                ? `无权查看${label}`
                : displayText || `选择${label}`}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </PopoverTrigger>

          {value && !disabled && !forbidden && !required && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-1 right-7 text-muted-foreground hover:text-foreground"
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
