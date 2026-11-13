import type { AnyFormApi } from "@tanstack/react-form"
import { getErrorMessage, getFieldErrors } from "@/lib/api-error"

export interface ServerFormErrors {
  fields: string[]
  summary: string
  global: string
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())
}

function hasPath(obj: unknown, path: string): boolean {
  if (!obj || typeof obj !== "object") return false
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      return false
    }
    current = (current as Record<string, unknown>)[part]
  }
  return parts.length > 0
}

function resolveFieldName(
  form: AnyFormApi,
  key: string,
  fieldNames?: Readonly<Record<string, string>>,
): string | undefined {
  const mapped = fieldNames && Object.hasOwn(fieldNames, key) ? fieldNames[key] : undefined
  const candidates = [mapped, key, snakeToCamel(key)].filter((name): name is string => Boolean(name))

  for (const name of candidates) {
    const listName = name.replace(/\[\d+\]$/, "")
    const instance = form.fieldInfo[name]?.instance ?? form.fieldInfo[listName]?.instance
    if (instance) return instance.name
  }

  for (const name of candidates) {
    if (name === mapped || hasPath(form.state.values, name)) {
      return name
    }
  }

  return undefined
}

export function applyServerErrors(
  form: AnyFormApi,
  error: unknown,
  fieldNames?: Readonly<Record<string, string>>,
  fallbackMessage = "操作失败，请检查输入后重试",
): ServerFormErrors {
  const fields: string[] = []
  const unmappedMessages: string[] = []

  for (const [key, message] of Object.entries(getFieldErrors(error))) {
    const fieldName = resolveFieldName(form, key, fieldNames)
    if (!fieldName) {
      unmappedMessages.push(message)
      continue
    }
    fields.push(fieldName)
    form.setFieldMeta(fieldName, (prev) => ({
      ...prev,
      errorMap: { ...prev?.errorMap, onServer: message },
    }))
  }

  const summary = getErrorMessage(error, fallbackMessage)
  return {
    fields,
    summary,
    global: unmappedMessages.join("；") || (fields.length === 0 ? summary : ""),
  }
}
