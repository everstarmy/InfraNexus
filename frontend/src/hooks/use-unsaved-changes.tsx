import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useBeforeUnload, useBlocker } from "react-router-dom"
import { useConfirm } from "@/components/common/confirm-dialog"

type RegisterDraft = (id: symbol, description: string | null) => void

const UnsavedChangesContext = createContext<RegisterDraft | null>(null)

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const confirm = useConfirm()
  const [drafts, setDrafts] = useState<Map<symbol, string>>(() => new Map())
  const registerDraft = useCallback<RegisterDraft>((id, description) => {
    setDrafts((current) => {
      if (description === null) {
        if (!current.has(id)) return current
        const next = new Map(current)
        next.delete(id)
        return next
      }
      if (current.get(id) === description) return current
      const next = new Map(current)
      next.delete(id)
      next.set(id, description)
      return next
    })
  }, [])
  const isDirty = drafts.size > 0
  const description = [...drafts.values()].at(-1) ?? "有尚未保存的更改。离开后这些更改将丢失。"
  const blocker = useBlocker(isDirty)
  const promptKey = useRef<string | null>(null)

  useBeforeUnload((event) => {
    if (!isDirty) return
    event.preventDefault()
    event.returnValue = ""
  })

  useEffect(() => {
    if (blocker.state !== "blocked") {
      promptKey.current = null
      return
    }
    const key = blocker.location.key
    if (promptKey.current === key) return
    promptKey.current = key
    void confirm({
      tone: "default",
      title: "离开当前页面？",
      description,
      confirmText: "放弃更改",
    }).then((discard) => {
      if (blocker.state !== "blocked") return
      if (discard) blocker.proceed()
      else blocker.reset()
    }).finally(() => {
      promptKey.current = null
    })
  }, [blocker, confirm, description])

  return <UnsavedChangesContext.Provider value={registerDraft}>{children}</UnsavedChangesContext.Provider>
}

export function useUnsavedChanges(isDirty: boolean, description = "有尚未保存的更改。离开后这些更改将丢失。") {
  const registerDraft = useContext(UnsavedChangesContext)
  if (!registerDraft) throw new Error("useUnsavedChanges must be used within UnsavedChangesProvider")
  const id = useRef(Symbol("unsaved-draft"))

  useLayoutEffect(() => {
    registerDraft(id.current, isDirty ? description : null)
    return () => registerDraft(id.current, null)
  }, [description, isDirty, registerDraft])
}
