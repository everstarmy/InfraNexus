/** Object key order is irrelevant; array order (especially sort priority) is significant. */
export function canonicalSnapshot(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)]))
    return item
  }
  return JSON.stringify(canonical(value)) ?? ""
}
