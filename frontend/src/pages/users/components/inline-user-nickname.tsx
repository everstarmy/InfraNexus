import { useNicknameDraft } from "./inline-edit-context"
import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Check, Pencil, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getErrorStatus } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { usersService } from "@/services/users"
import type { PageData, UserDTO } from "@/services/types"

export function InlineUserNickname({
  user,
  editable,
  stale = false,
}: {
  user: UserDTO
  editable: boolean
  stale?: boolean
}) {
  const draftContext = useNicknameDraft()
  const draft = draftContext?.drafts[user.id]
  const queryClient = useQueryClient()
  const [localEditing, setEditing] = useState(false)
  const editing = draftContext ? !!draft : localEditing
  const [localRevision, setLocalRevision] = useState(user.edit_revision)
  const [localValue, setLocalValue] = useState(user.nickname ?? "")
  const value = draft?.value ?? localValue
  const setValue = (value: string) => {
    setLocalValue(value)
    if (draft) draftContext?.set(user.id, { ...draft, value })
  }
  const [localSaving, setSaving] = useState(false)
  const saving = localSaving || !!draft?.pending
  const [conflict, setConflict] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const saveStarted = useRef(false)

  useEffect(() => {
    if (!editing) setValue(user.nickname ?? "")
  }, [editing, user.nickname, user.edit_revision])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const cancel = () => {
    if (saving) return
    draftContext?.set(user.id, null)
    setEditing(false)
    setConflict(false)
    setLocalValue(user.nickname ?? "")
  }

  const save = async () => {
    if (saving || saveStarted.current || stale || !editable || conflict) return
    const nickname = value.trim()
    if ([...nickname].length > 64) {
      notify.error("昵称不能超过 64 个字符")
      return
    }
    if (nickname === (user.nickname ?? "")) {
      draftContext?.set(user.id, null)
      setEditing(false)
      setConflict(false)
      return
    }
    saveStarted.current = true
    setSaving(true)
    if (draft) draftContext?.set(user.id, { ...draft, pending: true })
    try {
      const updated = (
        await usersService.update(user.id, {
          nickname,
          expected_revision: draft?.revision ?? localRevision,
        })
      ).data
      for (const [key, page] of queryClient.getQueriesData<PageData<UserDTO>>({
        queryKey: ["users", "list"],
      })) {
        if (!page?.items.some((item) => item.id === user.id)) continue
        queryClient.setQueryData<PageData<UserDTO>>(key, {
          ...page,
          items: page.items.map((item) => (item.id === user.id ? { ...item, ...updated } : item)),
        })
      }
      if (queryClient.getQueryData<UserDTO>(["users", "detail", user.id])) {
        queryClient.setQueryData(["users", "detail", user.id], updated)
      }
      for (const [key] of queryClient.getQueriesData({ queryKey: ["users", "row-detail"] })) {
        if (key.at(-1) === user.id) queryClient.setQueryData(key, updated)
      }
      draftContext?.set(user.id, null)
      notify.success("昵称已更新", user.username)
      setEditing(false)
      setConflict(false)
    } catch (error) {
      if (draft) draftContext?.set(user.id, { ...draft, pending: false })
      if (getErrorStatus(error) === 409) {
        setConflict(true)
        try {
          const latest = (await usersService.get(user.id)).data
          queryClient.setQueryData(["users", "detail", user.id], latest)
          // Keep the draft pinned to its original revision until explicit reconciliation.
        } catch {
          notify.error("最新资料加载失败，请稍后重新核对")
        }
      } else {
        notify.apiError(error, "昵称更新失败")
      }
    } finally {
      saveStarted.current = false
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="min-w-40 space-y-1.5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            value={value}
            maxLength={64}
            aria-label={`编辑 ${user.username} 的昵称`}
            aria-describedby={conflict ? `nickname-conflict-${user.id}` : undefined}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === "Enter") {
                event.preventDefault()
                void save()
              } else if (event.key === "Escape") {
                event.preventDefault()
                cancel()
              }
            }}
            disabled={saving || stale || !editable}
            className="h-8 min-w-0 text-xs"
          />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="保存昵称"
            onClick={() => void save()}
            disabled={saving || stale || !editable || conflict}
          >
            <Check />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="取消编辑昵称"
            onClick={cancel}
            disabled={saving}
          >
            <X />
          </Button>
        </div>
        {!editable && (
          <p role="alert" className="text-xs text-destructive">
            编辑权限已变化，草稿保留；无法保存。
          </p>
        )}
        {conflict && (
          <p
            id={`nickname-conflict-${user.id}`}
            role="alert"
            className="max-w-64 text-[11px] leading-4 text-destructive"
          >
            资料已被其他管理员修改，草稿已保留。请先重新加载并核对最新值。
          </p>
        )}
        {conflict && (
          <Button
            size="sm"
            variant="outline"
            disabled={saving || stale || !editable}
            onClick={async () => {
              try {
                const latest = (await usersService.get(user.id)).data
                setLocalRevision(latest.edit_revision)
                if (draftContext && draft)
                  draftContext.set(user.id, {
                    ...draft,
                    revision: latest.edit_revision,
                    original: latest.nickname ?? "",
                  })
                setConflict(false)
                notify.info(
                  `已核对最新昵称：${latest.nickname || "（空）"}，草稿仍保留，再次保存将覆盖该值`,
                )
              } catch (error) {
                notify.apiError(error, "加载最新资料失败")
              }
            }}
          >
            重新加载并核对最新版本
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      className="group/nickname flex min-w-0 items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="truncate text-sm font-medium text-foreground">
        {user.nickname || user.username}
      </span>
      {editable && user.auth_type === "local" && !user.built_in && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`编辑 ${user.nickname || user.username} 的昵称`}
          title="行内编辑昵称"
          disabled={stale}
          onClick={() => {
            setConflict(false)
            setLocalRevision(user.edit_revision)
            draftContext?.set(user.id, {
              value: user.nickname ?? "",
              original: user.nickname ?? "",
              revision: user.edit_revision,
            })
            setEditing(true)
          }}
          className="shrink-0 opacity-0 transition-opacity group-hover/nickname:opacity-100 group-focus-within/nickname:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:size-10 [@media(hover:none)]:opacity-100"
        >
          <Pencil />
        </Button>
      )}
    </div>
  )
}
