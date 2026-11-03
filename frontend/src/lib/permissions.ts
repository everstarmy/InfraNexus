export const ALL_PERMISSIONS = "*"

export function hasPermission(granted: readonly string[] | undefined, required: string | readonly string[]) {
  if (!granted) return false
  if (granted.includes(ALL_PERMISSIONS)) return true
  const list = typeof required === "string" ? [required] : required
  if (list.length === 0) return true
  return list.some((code) => granted.includes(code))
}
