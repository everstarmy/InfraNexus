import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { UserAvatar } from "@/components/common/user-avatar"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getErrorStatus } from "@/lib/api-error"
import { cn } from "@/lib/utils"
import { usersService } from "@/services/users"

export function UserPicker({
  value,
  valueLabel,
  onChange,
  placeholder = "选择人员",
  id,
}: {
  value: string | null
  valueLabel?: string
  onChange: (id: string | null, label?: string) => void
  placeholder?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const keyword = useDebouncedValue(search.trim(), 250)
  const query = useQuery({
    queryKey: ["users", "picker", keyword],
    queryFn: async () => (await usersService.list({ keyword: keyword || undefined, page_size: 20, status: "1" })).data.items,
    enabled: open,
    retry: false,
  })
  const forbidden = getErrorStatus(query.error) === 403

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger render={<Button id={id} type="button" variant="outline" className="h-8 w-full justify-between px-2.5 font-normal" />}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? valueLabel || "已选择" : placeholder}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </PopoverTrigger>
        {value && (
          <Button type="button" variant="ghost" size="icon-xs" className="absolute top-1 right-7 text-muted-foreground" onClick={() => onChange(null)} aria-label="清除">
            <X />
          </Button>
        )}
      </div>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="按用户名、姓名或邮箱搜索" />
          <CommandList>
            {query.isFetching && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Spinner />
                正在搜索…
              </div>
            )}
            {!query.isFetching && forbidden && <div className="px-3 py-6 text-center text-xs text-muted-foreground">当前角色无权读取人员列表</div>}
            {!query.isFetching && !forbidden && <CommandEmpty>没有匹配的人员</CommandEmpty>}
            {!query.isFetching && !forbidden && (
              <CommandGroup>
                {(query.data ?? []).map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.id}
                    onSelect={() => {
                      onChange(u.id, u.nickname || u.username)
                      setOpen(false)
                    }}
                  >
                    <UserAvatar name={u.nickname || u.username} seed={u.username} size="sm" />
                    <span className="truncate">{u.nickname || u.username}</span>
                    <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{u.username}</span>
                    {u.id === value && <Check className="text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
