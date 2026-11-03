import { DataTableFacetedFilter } from "./data-table-faceted-filter"
import { applyQueryDraft } from "./data-table-query-draft"
import { ListFilter } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  emptyQuery,
  operators,
  type FilterCondition,
  type FilterGroup,
  type QueryField,
  type TableQuery,
  type QueryValue,
} from "./data-table-query"

const labels: Record<FilterCondition["op"], string> = {
  eq: "等于",
  ne: "不等于",
  contains: "包含",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  in: "属于",
  between: "范围",
  empty: "为空",
  notEmpty: "不为空",
}
function enumToken(field: QueryField, value: string | number) {
  const options = field.options ?? []
  return options.filter(option => String(option.value) === String(value)).length > 1
    ? `option:${options.findIndex(option => option.value === value)}` : String(value)
}
function initial(field: QueryField): FilterCondition {
  return {
    field: field.key,
    op: operators(field)[0] as "eq" | "contains",
    value:
      field.type === "number"
        ? 0
        : field.type === "boolean"
          ? true
          : field.type === "enum"
            ? (field.options?.[0]?.value ?? "")
            : "",
  }
}
function GroupEditor({
  value,
  fields,
  onChange,
  depth = 1,
}: {
  value: FilterGroup
  fields: readonly QueryField[]
  onChange: (value: FilterGroup) => void
  depth?: number
}) {
  const replace = (index: number, node: FilterGroup | FilterCondition) =>
    onChange({ ...value, children: value.children.map((child, i) => (i === index ? node : child)) })
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
      <legend className="px-1 text-sm">条件组 {depth}</legend>
      <NativeSelect
        aria-label={`第${depth}层匹配方式`}
        value={value.logic}
        onChange={(event) => onChange({ ...value, logic: event.target.value as "and" | "or" })}
      >
        <NativeSelectOption value="and">满足全部（AND）</NativeSelectOption>
        <NativeSelectOption value="or">满足任意（OR）</NativeSelectOption>
      </NativeSelect>
      {value.children.map((node, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-2">
          {"logic" in node ? (
            <GroupEditor
              value={node}
              fields={fields}
              depth={depth + 1}
              onChange={(next) => replace(index, next)}
            />
          ) : (
            (() => {
              const field = fields.find((field) => field.key === node.field) ?? fields[0]
              const op = node.op
              const values =
                "value" in node ? (Array.isArray(node.value) ? node.value : [node.value]) : []
              const changeValue = (text: string, at: number) => {
                const parsed: QueryValue =
                  (field.type === "enum" && typeof field.options?.[0]?.value === "number")
                    ? Number(text)
                    : field.type === "boolean"
                      ? text === "true"
                      : text
                const next = [...values]
                next[at] = parsed
                replace(index, {
                  field: field.key,
                  op,
                  value: op === "between" || op === "in" ? next : parsed,
                } as FilterCondition)
              }
              return (
                <div className="flex flex-wrap items-end gap-2">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel>字段</FieldLabel>
                    <NativeSelect
                      aria-label={`条件${index + 1}字段`}
                      value={node.field}
                      onChange={(e) =>
                        replace(index, initial(fields.find((f) => f.key === e.target.value)!))
                      }
                    >
                      {fields.map((field) => (
                        <NativeSelectOption key={field.key} value={field.key}>
                          {field.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field className="min-w-0 flex-1">
                    <FieldLabel>操作</FieldLabel>
                    <NativeSelect
                      aria-label={`条件${index + 1}操作`}
                      value={op}
                      onChange={(e) => {
                        const next = e.target.value as FilterCondition["op"]
                        const initialValue = (initial(field) as { value?: QueryValue }).value ?? ""
                        replace(
                          index,
                          next === "empty" || next === "notEmpty"
                            ? { field: field.key, op: next }
                            : ({
                                field: field.key,
                                op: next,
                                value:
                                  next === "between"
                                    ? [values[0] ?? initialValue, values[0] ?? initialValue]
                                    : next === "in"
                                      ? [values[0] ?? initialValue]
                                      : (values[0] ?? initialValue),
                              } as FilterCondition),
                        )
                      }}
                    >
                      {operators(field).map((op) => (
                        <NativeSelectOption key={op} value={op}>
                          {labels[op]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  {op !== "empty" &&
                    op !== "notEmpty" &&
                    (op === "in" ? (
                      <Field className="basis-full">
                        <FieldLabel>值（多选）</FieldLabel>
                        <DataTableFacetedFilter title={`条件${index + 1}值`}
                          options={(field.options ?? []).map((option, i) => ({ label: option.label, value: String(i) }))}
                          selectedValues={(field.options ?? []).flatMap((option, i) => values.includes(option.value) ? [String(i)] : [])}
                          onSelectedChange={selected => replace(index, { field: field.key, op: "in", value: selected.map(index => field.options![Number(index)].value) })}
                        />
                      </Field>
                    ) : (
                      Array.from({ length: op === "between" ? 2 : 1 }, (_, at) => (
                        <Field key={at} className="min-w-0 flex-1">
                          <FieldLabel>{at ? "终点" : "值"}</FieldLabel>
                          {field.type === "enum" || field.type === "boolean" ? (
                            <NativeSelect
                              aria-label={`条件${index + 1}值${at + 1}`}
                              value={field.type === "enum" ? enumToken(field, values[at] as string | number) : String(values[at])}
                              onChange={(e) => {
                                if (field.type === "enum") replace(index, { field: field.key, op: op as "eq" | "ne", value: field.options!.find(option => enumToken(field, option.value) === e.target.value)!.value })
                                else changeValue(e.target.value, at)
                              }}
                            >
                              {(
                                field.options ?? [
                                  { value: "true", label: "是" },
                                  { value: "false", label: "否" },
                                ]
                               ).map((option, optionIndex) => (
                                <NativeSelectOption key={optionIndex} value={field.type === "enum" ? enumToken(field, option.value) : String(option.value)}>
                                  {option.label}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          ) : (
                            <Input
                              aria-label={`条件${index + 1}值${at + 1}`}
                              data-query-field={field.key}
                              type="text"
                              inputMode={field.type === "number" ? "decimal" : undefined}
                              placeholder={
                                field.type === "date" ? "2026-10-28T00:00:00+08:00" : undefined
                              }
                              value={String(values[at] ?? "")}
                              onChange={(e) => changeValue(e.target.value, at)}
                            />
                          )}
                        </Field>
                      ))
                    ))}
                </div>
              )
            })()
          )}
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            onClick={() =>
              onChange({ ...value, children: value.children.filter((_, i) => i !== index) })
            }
          >
            移除条件{index + 1}
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...value, children: [...value.children, initial(fields[0])] })}
        >
          添加条件
        </Button>
        {depth < 3 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({ ...value, children: [...value.children, { logic: "and", children: [] }] })
            }
          >
            添加条件组
          </Button>
        )}
      </div>
    </fieldset>
  )
}
export function DataTableQueryEditor({
  value,
  fields,
  onChange,
}: {
  value: TableQuery
  fields: readonly QueryField[]
  onChange: (query: TableQuery) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState("")
  const editorRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`高级查询${value.filter.children.length || value.sorts.length ? " · 已应用" : ""}`}
        title="高级查询与排序"
        onClick={() => {
          setDraft(value)
          setError("")
          setOpen(true)
        }}
      >
        <ListFilter />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent ref={editorRef} className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>高级查询与排序</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            最多 3 层、20 个条件、3 个排序字段。日期需包含时区，范围包含两端；空值排序始终置后。
          </p>
          <GroupEditor
            value={draft.filter}
            fields={fields}
            onChange={(filter) => setDraft({ ...draft, filter })}
          />
          <fieldset className="flex flex-col gap-2">
            <legend>排序优先级</legend>
            {draft.sorts.map((sort, index) => (
              <div key={index} className="flex flex-wrap gap-2">
                <span>{index + 1}</span>
                <NativeSelect
                  aria-label={`排序${index + 1}字段`}
                  value={sort.field}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.map((item, i) =>
                        i === index ? { ...item, field: e.target.value } : item,
                      ),
                    })
                  }
                >
                  {fields
                    .filter((field) => field.sortable !== false)
                    .map((field) => (
                      <NativeSelectOption key={field.key} value={field.key}>
                        {field.label}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <NativeSelect
                  aria-label={`排序${index + 1}方向`}
                  value={sort.desc ? "desc" : "asc"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.map((item, i) =>
                        i === index ? { ...item, desc: e.target.value === "desc" } : item,
                      ),
                    })
                  }
                >
                  <NativeSelectOption value="asc">升序</NativeSelectOption>
                  <NativeSelectOption value="desc">降序</NativeSelectOption>
                </NativeSelect>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => {
                    const sorts = [...draft.sorts]
                    ;[sorts[index - 1], sorts[index]] = [sorts[index], sorts[index - 1]]
                    setDraft({ ...draft, sorts })
                  }}
                >
                  提高优先级
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft({ ...draft, sorts: draft.sorts.filter((_, i) => i !== index) })
                  }
                >
                  移除排序{index + 1}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={
                draft.sorts.length >= 3 ||
                !fields.some(
                  (field) =>
                    field.sortable !== false &&
                    !draft.sorts.some((sort) => sort.field === field.key),
                )
              }
              onClick={() =>
                setDraft({
                  ...draft,
                  sorts: [
                    ...draft.sorts,
                    {
                      field: fields.find(
                        (field) =>
                          field.sortable !== false &&
                          !draft.sorts.some((sort) => sort.field === field.key),
                      )!.key,
                      desc: false,
                    },
                  ],
                })
              }
            >
              添加排序
            </Button>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDraft({ ...emptyQuery(), search: value.search })}
            >
              清空条件与排序
            </Button>
            <Button
              onClick={() => {
                try {
                  onChange(applyQueryDraft(draft, fields))
                  setOpen(false)
                } catch (error) {
                  const message = error instanceof Error ? error.message : "查询无效"
                  setError(message)
                  const field = fields.find(item => message.startsWith(item.label))
                  if (field) Array.from(editorRef.current?.querySelectorAll<HTMLInputElement>("input[data-query-field]") ?? []).find(input => input.dataset.queryField === field.key)?.focus()
                }
              }}
            >
              应用查询
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
