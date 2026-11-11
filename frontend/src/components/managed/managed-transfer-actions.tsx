import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { useAuth } from "@/stores/auth-context"
import {
  newManagedIdempotencyKey,
  type ManagedBase,
  type ManagedImportError,
  type ManagedQueryParams,
  type createManagedClient,
} from "@/services/managed"

export function ManagedTransferActions<T extends ManagedBase>({
  permission,
  label,
  service,
  filters,
  onImported,
}: {
  permission: string
  label: string
  service: Pick<
    ReturnType<typeof createManagedClient<T>>,
    "importPreview" | "importCommit" | "export"
  >
  filters?: ManagedQueryParams
  onImported: () => void
}) {
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState("")
  const [message, setMessage] = useState("")
  const [rowErrors, setRowErrors] = useState<ManagedImportError[]>([])
  const [preview, setPreview] = useState<{ items: Partial<T>[]; key: string } | null>(null)
  const exportRows = useMutation({
    mutationFn: () => service.export(filters),
    onSuccess: ({ data }) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data ?? [], null, 2)], { type: "application/json" }),
      )
      const link = document.createElement("a")
      link.href = url
      link.download = `${permission.split(":").at(-1)}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    },
    onError: (error) => notify.error("导出失败", getErrorMessage(error)),
  })
  const previewRows = useMutation({
    mutationFn: (items: Partial<T>[]) => service.importPreview(items),
    onSuccess: ({ data }, items) => {
      const errors = data.errors ?? []
      setRowErrors(errors)
      if (errors.length === 0) {
        const key = newManagedIdempotencyKey()
        setPreview({ items, key })
      }
    },
    onError: (error) => setMessage(getErrorMessage(error)),
  })
  const commitRows = useMutation({
    mutationFn: ({ items, key }: NonNullable<typeof preview>) => service.importCommit(items, key),
    onSuccess: ({ data }) => {
      if (data.errors?.length) {
        setRowErrors(data.errors)
        setPreview(null)
        return
      }
      onImported()
      setOpen(false)
      notify.success(`已导入 ${data.items.length} 条${label}`)
    },
    onError: (error) => setMessage(getErrorMessage(error)),
  })
  const busy = previewRows.isPending || commitRows.isPending
  const resetPreview = () => {
    setPreview(null)
    setMessage("")
    setRowErrors([])
  }
  const runPreview = () => {
    resetPreview()
    try {
      const value: unknown = JSON.parse(raw)
      if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > 100 ||
        value.some((row) => !row || typeof row !== "object" || Array.isArray(row))
      ) {
        setMessage("请输入由 1 至 100 条对象记录组成的 JSON 数组。")
        return
      }
      previewRows.mutate(value)
    } catch {
      setMessage("JSON 格式无效，请检查后重新预检。")
    }
  }
  return (
    <>
      {can(`${permission}:import`) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRaw("")
            resetPreview()
            setOpen(true)
          }}
        >
          导入
        </Button>
      )}
      {can(`${permission}:export`) && (
        <Button
          size="sm"
          variant="outline"
          disabled={exportRows.isPending}
          onClick={() => exportRows.mutate()}
        >
          导出
        </Button>
      )}
      {open && can(`${permission}:import`) && (
        <Dialog open onOpenChange={(next) => !busy && setOpen(next)}>
          <DialogContent className="max-h-[85svh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>批量导入{label}</DialogTitle>
              <DialogDescription>
                粘贴 1 至 100 条 JSON 记录。预检通过后可一次提交，任一行失败时整批回滚。
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="managed-import-json">JSON 记录</FieldLabel>
              <Textarea
                id="managed-import-json"
                className="font-mono"
                rows={8}
                value={raw}
                disabled={busy}
                onChange={(event) => {
                  setRaw(event.target.value)
                  resetPreview()
                }}
              />
            </Field>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            {rowErrors.length > 0 && (
              <ul role="alert" className="list-inside list-disc space-y-1 text-sm text-destructive">
                {rowErrors.map((error) => (
                  <li key={error.row}>
                    第 {error.row} 行：{error.message}
                  </li>
                ))}
              </ul>
            )}
            {preview && (
              <p role="status" className="text-sm">
                预检通过，共 {preview.items.length} 条。
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={runPreview}
                disabled={busy || !!preview || !raw.trim()}
              >
                预检
              </Button>
              <Button
                disabled={busy || !preview}
                onClick={() => {
                  if (preview) {
                    setMessage("")
                    commitRows.mutate(preview)
                  }
                }}
              >
                提交导入
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
