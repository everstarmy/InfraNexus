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
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(user.nickname ?? "")
  const [saving, setSaving] = useState(false)
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
    setEditing(false)
    setConflict(false)
    setValue(user.nickname ?? "")
  }

  const save = async () => {
    if (saving || saveStarted.current || stale) return
    const nickname = value.trim()
    if (nickname.length > 64) {
      notify.error("昵称不能超过 64 个字符")
      return
    }
    if (nickname === (user.nickname ?? "")) {
      setEditing(false)
      setConflict(false)
      return
    }
    saveStarted.current = true
    setSaving(true)
    try {
      const updated = (await usersService.update(user.id, {
        nickname,
        expected_revision: user.edit_revision,
      })).data
      for (const [key, page] of queryClient.getQueriesData<PageData<UserDTO>>({ queryKey: ["users", "list"] })) {
        if (!page?.items.some((item) => item.id === user.id)) continue
        queryClient.setQueryData<PageData<UserDTO>>(key, {
          ...page,
          items: page.items.map((item) => item.id === user.id ? { ...item, ...updated } : item),
        })
      }
      if (queryClient.getQueryData<UserDTO>(["users", "detail", user.id])) {
        queryClient.setQueryData(["users", "detail", user.id], updated)
      }
      notify.success("昵称已更新", user.username)
      setEditing(false)
      setConflict(false)
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        setConflict(true)
        void queryClient.invalidateQueries({ queryKey: ["users"] })
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
              } else if (event.key === "Tab" && value.trim() !== (user.nickname ?? "")) {
                void save()
              }
            }}
            disabled={saving || stale}
            className="h-8 min-w-0 text-xs"
          />
          <Button size="icon-xs" variant="ghost" aria-label="保存昵称" onClick={() => void save()} disabled={saving || stale}>
            <Check />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="取消编辑昵称" onClick={cancel} disabled={saving}>
            <X />
          </Button>
        </div>
        {conflict && (
          <p id={`nickname-conflict-${user.id}`} role="alert" className="max-w-64 text-[11px] leading-4 text-destructive">
            资料已被其他管理员修改，草稿已保留。请确认列表中的最新版本后再保存。
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="group/nickname flex min-w-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      <span className="truncate text-sm font-medium text-foreground">{user.nickname || user.username}</span>
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
            setEditing(true)
          }}
          className="shrink-0 opacity-0 transition-opacity group-hover/nickname:opacity-100 group-focus-within/nickname:opacity-100 focus-visible:opacity-100"
        >
          <Pencil />
        </Button>
      )}
    </div>
  )
}
