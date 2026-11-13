import { useLayoutEffect, useRef, useState } from "react"
import { revalidateLogic, useForm, useStore, type DeepKeys, type StandardSchemaV1 } from "@tanstack/react-form"
import { applyServerErrors, type ServerFormErrors } from "./server-errors"

export function focusFirstInvalidField(container: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    if (!container?.isConnected) return
    const candidates = container.querySelectorAll<HTMLElement>(
      'input[aria-invalid="true"], button[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"], [tabindex][aria-invalid="true"]',
    )
    for (const control of candidates) {
      if (control.matches(':disabled, [aria-disabled="true"]') || control.closest('[hidden], [aria-hidden="true"], [inert]')) continue
      control.focus()
      if (control.ownerDocument.activeElement === control) break
    }
  })
}

export interface UseAppFormOptions<TFormData extends object> {
  defaultValues: TFormData
  schema: StandardSchemaV1<NoInfer<TFormData>, unknown>
  open?: boolean
  resetKey?: string
  serverFieldNames?: Readonly<Record<string, DeepKeys<NoInfer<TFormData>>>>
  onSubmit: (values: TFormData) => Promise<unknown>
  onSubmitInvalid?: (invalidFields: string[]) => void
  onServerErrors?: (result: ServerFormErrors) => void
  onError?: (err: unknown) => void
  fallbackErrorMessage?: string
}

export function useAppForm<TFormData extends object>({
  defaultValues,
  schema,
  open = true,
  resetKey,
  serverFieldNames,
  onSubmit,
  onSubmitInvalid,
  onServerErrors,
  onError,
  fallbackErrorMessage,
}: UseAppFormOptions<TFormData>) {
  const [serverErrors, setServerErrors] = useState<ServerFormErrors>()
  const formRef = useRef<HTMLFormElement>(null)
  const baseline = useRef(defaultValues)
  const session = useRef({ open, resetKey })
  const submitting = useRef(false)

  const form = useForm({
    defaultValues: baseline.current,
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onDynamic: schema },
    listeners: {
      onChange: ({ fieldApi }) => {
        if (fieldApi.state.meta.errorMap.onServer) {
          fieldApi.setMeta((prev) => ({
            ...prev,
            errorMap: { ...prev.errorMap, onServer: undefined },
          }))
          setServerErrors((prev) => prev && ({
            ...prev,
            fields: prev.fields.filter((name) => name !== fieldApi.name),
          }))
        }
      },
    },
    onSubmitInvalid: ({ formApi }) => {
      const invalidFields = Object.entries(formApi.state.fieldMeta)
        .filter(([, meta]) => ((meta as { errors?: unknown[] } | undefined)?.errors?.length ?? 0) > 0)
        .map(([name]) => name)
      onSubmitInvalid?.(invalidFields)
      focusFirstInvalidField(formRef.current)
    },
    onSubmit: async ({ value, formApi }) => {
      const activeSession = session.current
      setServerErrors(undefined)
      try {
        await onSubmit(value)
      } catch (err) {
        if (session.current !== activeSession) return
        const result = applyServerErrors(formApi, err, serverFieldNames, fallbackErrorMessage)
        setServerErrors(result)
        onServerErrors?.(result)
        focusFirstInvalidField(formRef.current)
        onError?.(err)
      }
    },
  })

  useLayoutEffect(() => {
    const previous = session.current
    if (previous.open === open && previous.resetKey === resetKey) return
    session.current = { open, resetKey }
    if (!open) return

    baseline.current = defaultValues
    form.reset(defaultValues)
    setServerErrors(undefined)
  }, [open, resetKey, defaultValues, form])

  const hasChanges = useStore(form.store, (state) => !state.isDefaultValue)

  async function submit() {
    if (submitting.current || !open) return
    submitting.current = true
    try {
      await form.handleSubmit()
    } finally {
      submitting.current = false
    }
  }

  function clearErrors() {
    setServerErrors(undefined)
    form.reset(form.state.values, { keepDefaultValues: true })
  }

  return {
    form,
    formRef,
    submit,
    clearErrors,
    hasChanges,
    formError: serverErrors?.global || (serverErrors?.fields.length ? serverErrors.summary : ""),
  }
}
