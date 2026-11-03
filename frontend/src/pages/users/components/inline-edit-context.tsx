import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
export interface NicknameDraft {
  value: string
  revision: number
  original: string
  pending?: boolean
}
const Context = createContext<{
  drafts: Record<string, NicknameDraft>
  set: (id: string, draft: NicknameDraft | null) => void
} | null>(null)
export function UserInlineEditProvider({
  children,
  onDirtyChange,
}: {
  children: ReactNode
  onDirtyChange: (dirty: boolean) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, NicknameDraft>>({})
  const confirm = useConfirm()
  const dirty = Object.keys(drafts).length > 0
  useUnsavedChanges(dirty, "表格中仍有昵称编辑草稿；离开页面将丢失未保存内容。")
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])
  const set = (id: string, draft: NicknameDraft | null) =>
    setDrafts((current) => {
      const next = { ...current }
      if (draft) next[id] = draft
      else delete next[id]
      return next
    })
  return (
    <Context.Provider value={{ drafts, set }}>
      {dirty && (
        <div
          role="status"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
        >
          有 {Object.keys(drafts).length} 行编辑草稿。翻页和筛选后仍保留，返回该行可继续编辑。
          <Button
            size="sm"
            variant="outline"
            disabled={Object.values(drafts).some((draft) => draft.pending)}
            onClick={async () => {
              if (
                await confirm({
                  title: "放弃全部表格草稿？",
                  confirmText: "放弃草稿",
                  tone: "default",
                })
              )
                setDrafts({})
            }}
          >
            放弃全部草稿
          </Button>
        </div>
      )}
      {children}
    </Context.Provider>
  )
}
export function useNicknameDraft() {
  return useContext(Context)
}
