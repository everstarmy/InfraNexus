import * as React from "react"
import type { AnyFieldApi } from "@tanstack/react-form"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"

export interface FormFieldRenderProps {
  id: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}

export interface FormFieldProps {
  field: AnyFieldApi
  label?: React.ReactNode
  description?: React.ReactNode
  required?: boolean
  className?: string
  id?: string
  idPrefix?: string
  children: (props: FormFieldRenderProps) => React.ReactNode
}

function formatError(err: unknown): string {
  if (!err) return ""
  if (typeof err === "string") return err
  if (typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message
  }
  return String(err)
}

export function FormField({
  field,
  label,
  description,
  required,
  className,
  id,
  idPrefix = "field",
  children,
}: FormFieldProps) {
  const { meta } = field.state
  const submissionAttempts = field.form.state.submissionAttempts

  const serverError = meta.errorMap?.onServer ? formatError(meta.errorMap.onServer) : ""
  const clientError = meta.errors.length > 0 ? formatError(meta.errors[0]) : ""

  const hasServerError = Boolean(serverError)
  const hasClientError = (meta.isTouched || submissionAttempts > 0) && Boolean(clientError)
  const shouldShowError = hasServerError || hasClientError

  const errorMessage = serverError || clientError || ""
  const fieldId = id ?? `${idPrefix}-${String(field.name)}`
  const descriptionId = `${fieldId}-description`
  const errorId = `${fieldId}-error`

  return (
    <Field data-invalid={shouldShowError || undefined} className={className}>
      {label && (
        <FieldLabel htmlFor={fieldId}>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </FieldLabel>
      )}
      {children({
        id: fieldId,
        "aria-invalid": shouldShowError || undefined,
        "aria-describedby": shouldShowError ? errorId : description ? descriptionId : undefined,
      })}
      {description && !shouldShowError && (
        <FieldDescription id={descriptionId} className="text-xs">{description}</FieldDescription>
      )}
      {shouldShowError && (
        <FieldError id={errorId} className="text-xs">
          {errorMessage}
        </FieldError>
      )}
    </Field>
  )
}
