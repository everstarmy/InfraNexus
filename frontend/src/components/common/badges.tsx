import { Building2, KeyRound, Network } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { AuthType } from "@/services/types"

const authSources: Record<AuthType, { label: string; icon: typeof KeyRound; className: string }> = {
  local: {
    label: "本地",
    icon: KeyRound,
    className: "border-border bg-muted/60 text-muted-foreground",
  },
  ad: {
    label: "AD 域",
    icon: Building2,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  ldap: {
    label: "LDAP",
    icon: Network,
    className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
}

export function AuthSourceBadge({ authType, domain }: { authType: AuthType; domain?: string }) {
  const source = authSources[authType] ?? authSources.local
  const Icon = source.icon
  const badge = (
    <Badge variant="outline" className={cn("gap-1 font-medium", source.className)}>
      <Icon />
      {source.label}
    </Badge>
  )
  if (!domain) return badge
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{badge}</TooltipTrigger>
      <TooltipContent>认证域：{domain}</TooltipContent>
    </Tooltip>
  )
}

export function StatusDot({ active, activeText = "启用", inactiveText = "停用" }: { active: boolean; activeText?: string; inactiveText?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className="relative flex size-2">
        {active && <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />}
        <span className={cn("relative inline-flex size-2 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      </span>
      <span className={active ? "text-foreground" : "text-muted-foreground"}>{active ? activeText : inactiveText}</span>
    </span>
  )
}

export function BuiltinBadge() {
  return (
    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
      内置
    </Badge>
  )
}

const methodStyles: Record<string, string> = {
  GET: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  POST: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PUT: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  PATCH: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  DELETE: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}

export function MethodBadge({ method }: { method?: string }) {
  if (!method) return null
  return (
    <Badge variant="outline" className={cn("h-4.5 rounded-md px-1.5 font-mono text-[10px] font-semibold", methodStyles[method] ?? "")}>
      {method}
    </Badge>
  )
}
