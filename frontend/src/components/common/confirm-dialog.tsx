import * as React from "react"
import { Info, TriangleAlert } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  details?: React.ReactNode
  confirmText?: string
  cancelText?: string
  tone?: "destructive" | "default"
  onConfirm?: () => Promise<unknown> | unknown
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null)
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const active = React.useRef<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null)
  const queue = React.useRef<Array<{ options: ConfirmOptions; resolve: (value: boolean) => void }>>([])

  const confirm = React.useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      const entry = { options: next, resolve }
      if (active.current) {
        queue.current.push(entry)
        return
      }
      active.current = entry
      setOptions(next)
      setOpen(true)
    })
  }, [])

  const settle = (value: boolean) => {
    active.current?.resolve(value)
    active.current = queue.current.shift() ?? null
    if (active.current) {
      setOptions(active.current.options)
    } else {
      setOptions(null)
      setOpen(false)
    }
  }

  const handleConfirm = async () => {
    if (!options?.onConfirm) return settle(true)
    setPending(true)
    try {
      await options.onConfirm()
      settle(true)
    } catch {
      return
    } finally {
      setPending(false)
    }
  }

  const destructive = (options?.tone ?? "destructive") === "destructive"

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !pending) settle(false)
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogMedia
              className={cn(
                "relative overflow-visible",
                destructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
              )}
            >
              {destructive && (
                <span aria-hidden className="absolute inset-0 rounded-md bg-destructive/25 motion-safe:animate-soft-ping" />
              )}
              {destructive ? (
                <TriangleAlert className="relative motion-safe:animate-attention" />
              ) : (
                <Info className="relative" />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            {options?.description && <AlertDialogDescription>{options.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          {options?.details}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{options?.cancelText ?? "取消"}</AlertDialogCancel>
            <AlertDialogAction
              variant={destructive ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={pending}
              className={cn(destructive && "bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/80")}
            >
              {pending && <Spinner />}
              {options?.confirmText ?? (destructive ? "确认删除" : "确认")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider")
  return ctx
}
