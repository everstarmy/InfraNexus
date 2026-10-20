import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

const palettes = [
  "from-violet-500/20 to-violet-500/5 text-violet-700 dark:text-violet-300",
  "from-sky-500/20 to-sky-500/5 text-sky-700 dark:text-sky-300",
  "from-emerald-500/20 to-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  "from-amber-500/25 to-amber-500/5 text-amber-700 dark:text-amber-300",
  "from-rose-500/20 to-rose-500/5 text-rose-700 dark:text-rose-300",
  "from-indigo-500/20 to-indigo-500/5 text-indigo-700 dark:text-indigo-300",
]

function hash(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

export function UserAvatar({ name, seed, size = "default", className }: { name: string; seed: string; size?: "sm" | "default" | "lg"; className?: string }) {
  const initial = [...(name || "?")][0]?.toUpperCase()
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback className={cn("bg-gradient-to-br text-xs font-semibold", palettes[hash(seed) % palettes.length], size === "lg" && "text-base")}>
        {initial}
      </AvatarFallback>
    </Avatar>
  )
}
