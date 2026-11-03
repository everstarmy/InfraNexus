import * as React from "react"
import { ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DepartmentTree } from "@/components/common/department-tree"
import { findPath } from "@/lib/tree"
import { cn } from "@/lib/utils"
import type { DepartmentNode } from "@/services/departments"

export function departmentPathLabel(nodes: DepartmentNode[], id?: string | null) {
  if (!id) return ""
  return findPath(nodes, id).map((n) => n.name).join(" / ")
}

export function DepartmentSelect({
  nodes,
  value,
  onChange,
  placeholder = "选择部门",
  allowClear = false,
  disabledKeys,
  disableInactive = true,
  className,
  id,
}: {
  nodes: DepartmentNode[]
  value?: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  allowClear?: boolean
  disabledKeys?: ReadonlySet<string>
  disableInactive?: boolean
  className?: string
  id?: string
}) {
  const [open, setOpen] = React.useState(false)
  const label = departmentPathLabel(nodes, value)
  const blocked = React.useMemo(() => {
    const set = new Set(disabledKeys ?? [])
    if (disableInactive) {
      const walk = (list: DepartmentNode[]) =>
        list.forEach((n) => {
          if (n.status !== 1) set.add(n.id)
          walk(n.children ?? [])
        })
      walk(nodes)
    }
    return set
  }, [nodes, disabledKeys, disableInactive])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative w-full", className)}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className="h-8 w-full justify-between px-2.5 font-normal"
            />
          }
        >
          <span className={cn("truncate", !label && "text-muted-foreground")}>{label || placeholder}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </PopoverTrigger>
        {allowClear && value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1 right-7 text-muted-foreground"
            onClick={() => onChange(null)}
            aria-label="清除部门"
          >
            <X />
          </Button>
        )}
      </div>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-2">
        <div className="max-h-80 overflow-y-auto pr-1">
          <DepartmentTree
            nodes={nodes}
            selectedKey={value}
            showCounts={false}
            disabledKeys={blocked}
            onSelect={(key) => {
              onChange(key)
              setOpen(false)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
