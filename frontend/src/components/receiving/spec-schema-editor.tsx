import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import type { AssetSpec, SpecSchemaDTO, SpecSchemaFieldDTO } from "@/services/receiving-metadata"
import { formatBytes, labelSpecField } from "./receiving-meta"

export function validateSpecAgainstSchema(
  spec: Record<string, unknown>,
  schema?: SpecSchemaDTO,
): string | null {
  if (!schema) return null
  for (const field of schema.fields) {
    if (field.name === "schema_version") continue
    const val = spec[field.name]
    const empty = val === undefined || val === null || val === ""
    if (field.required && empty) {
      return `请填写必填规格字段「${labelSpecField(field)}」`
    }
    if (empty) continue
    if (field.type === "integer" || field.type === "number") {
      const n = typeof val === "number" ? val : Number(val)
      if (!Number.isFinite(n)) {
        return `规格字段「${labelSpecField(field)}」必须为有效数字`
      }
      if (field.type === "integer" && !Number.isInteger(n)) {
        return `规格字段「${labelSpecField(field)}」必须为整数`
      }
      if (field.minimum !== undefined && n < field.minimum) {
        return `规格字段「${labelSpecField(field)}」不能小于 ${field.minimum}`
      }
      if (field.maximum !== undefined && n > field.maximum) {
        return `规格字段「${labelSpecField(field)}」不能大于 ${field.maximum}`
      }
    }
    if (field.type === "string" && typeof val === "string") {
      if (field.max_length && val.trim().length > field.max_length) {
        return `规格字段「${labelSpecField(field)}」长度不能超过 ${field.max_length}`
      }
      if (field.enum && field.enum.length > 0 && !field.enum.includes(val)) {
        return `规格字段「${labelSpecField(field)}」选项无效`
      }
    }
  }
  return null
}

function renderSpecValue(field: SpecSchemaFieldDTO, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—"
  if (field.type === "boolean") return value ? "是" : "否"
  if (field.unit === "bytes" && typeof value === "number") return formatBytes(value)
  if (field.unit) return `${value} ${field.unit}`
  return String(value)
}

export function SpecSchemaEditor({
  schema,
  value,
  onChange,
  disabled,
}: {
  schema?: SpecSchemaDTO
  value: AssetSpec
  onChange: (next: AssetSpec) => void
  disabled?: boolean
}) {
  if (!schema) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
        暂未加载到规格定义（请稍候或刷新元数据）。
      </div>
    )
  }

  const editableFields = schema.fields.filter((f) => f.name !== "schema_version")

  const setField = (name: string, nextVal: unknown) => {
    onChange({
      ...value,
      schema_version: schema.schema_version,
      [name]: nextVal,
    })
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {editableFields.map((field) => {
        const current = value[field.name]
        const fieldId = `spec-${field.name}`
        const isTextarea = field.name === "description"

        return (
          <div
            key={field.name}
            className={isTextarea ? "col-span-12 space-y-1.5" : "col-span-12 sm:col-span-6 lg:col-span-4 space-y-1.5"}
          >
            <Label htmlFor={fieldId} className="text-xs font-medium flex items-center gap-1">
              <span>{labelSpecField(field)}</span>
              {field.required && <span className="text-destructive">*</span>}
            </Label>

            {field.type === "boolean" ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3">
                <Checkbox
                  id={fieldId}
                  checked={Boolean(current)}
                  disabled={disabled}
                  onCheckedChange={(checked) => setField(field.name, checked ? true : null)}
                />
                <label htmlFor={fieldId} className="text-xs text-muted-foreground select-none cursor-pointer">
                  {current === true ? "是" : current === false ? "否" : "未设置 / 否"}
                </label>
              </div>
            ) : field.enum && field.enum.length > 0 ? (
              <NativeSelect
                id={fieldId}
                value={typeof current === "string" ? current : ""}
                disabled={disabled}
                onChange={(e) => setField(field.name, e.target.value || null)}
              >
                <NativeSelectOption value="">{field.required ? "请选择" : "未指定"}</NativeSelectOption>
                {field.enum.map((opt) => (
                  <NativeSelectOption key={opt} value={opt}>
                    {opt}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : isTextarea ? (
              <Textarea
                id={fieldId}
                rows={2}
                disabled={disabled}
                maxLength={field.max_length}
                value={typeof current === "string" ? current : ""}
                placeholder="可选补充说明"
                onChange={(e) => setField(field.name, e.target.value || null)}
              />
            ) : field.type === "integer" || field.type === "number" ? (
              <Input
                id={fieldId}
                type="number"
                step={field.type === "integer" ? 1 : "any"}
                min={field.minimum}
                max={field.maximum}
                disabled={disabled}
                value={current === undefined || current === null ? "" : String(current)}
                placeholder={field.unit ? `单位: ${field.unit}` : "请输入数值"}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === "") {
                    setField(field.name, null)
                    return
                  }
                  const n = Number(raw)
                  setField(field.name, Number.isFinite(n) ? n : raw)
                }}
              />
            ) : (
              <Input
                id={fieldId}
                type="text"
                maxLength={field.max_length}
                disabled={disabled}
                value={typeof current === "string" ? current : ""}
                placeholder="请输入"
                onChange={(e) => setField(field.name, e.target.value || null)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SpecSummaryGrid({
  schema,
  spec,
}: {
  schema?: SpecSchemaDTO
  spec?: AssetSpec | null
}) {
  if (!spec) return <p className="text-xs text-muted-foreground">暂无规格信息</p>
  if (!schema) {
    const entries = Object.entries(spec).filter(([k, v]) => k !== "schema_version" && v !== null && v !== undefined && v !== "")
    if (entries.length === 0) return <p className="text-xs text-muted-foreground">未录入规格参数</p>
    return (
      <div className="grid grid-cols-12 gap-3 text-xs">
        {entries.map(([key, val]) => (
          <div key={key} className="col-span-6 md:col-span-4 rounded-md border bg-muted/20 p-2.5">
            <div className="text-muted-foreground">{key}</div>
            <div className="mt-1 font-medium text-foreground">{String(val)}</div>
          </div>
        ))}
      </div>
    )
  }

  const fields = schema.fields.filter((f) => f.name !== "schema_version")
  return (
    <div className="grid grid-cols-12 gap-3 text-xs">
      {fields.map((field) => (
        <div key={field.name} className="col-span-6 md:col-span-4 rounded-md border bg-muted/20 p-2.5">
          <div className="text-muted-foreground">{labelSpecField(field)}</div>
          <div className="mt-1 font-medium text-foreground">{renderSpecValue(field, spec[field.name])}</div>
        </div>
      ))}
    </div>
  )
}
