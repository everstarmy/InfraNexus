import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { notify } from "@/lib/notify"

export function ReasonPromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "原因说明",
  placeholder = "请填写操作原因...",
  required = true,
  confirmText = "确认执行",
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label?: string
  placeholder?: string
  required?: boolean
  confirmText?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: (reason: string) => unknown | Promise<unknown>
}) {
  const [reason, setReason] = useState("")

  useEffect(() => {
    if (open) setReason("")
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (required && !reason.trim()) {
              notify.warning(`请填写${label}`)
              return
            }
            await onConfirm(reason.trim())
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="reason-input" className="text-xs">
              {label} {required ? "*" : "（可选）"}
            </Label>
            <Textarea
              id="reason-input"
              rows={3}
              maxLength={1024}
              value={reason}
              disabled={pending}
              placeholder={placeholder}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {pending ? "处理中..." : confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
