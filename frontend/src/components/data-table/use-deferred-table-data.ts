import { useState } from "react"
/** Hold the displayed snapshot during interaction; changed query scope always loads its own rows. */
export function useDeferredTableData<T>(data: T, scope: string, locked: boolean, pending = false) {
  const [snapshot, setSnapshot] = useState({ data, scope })
  if (pending && snapshot.scope !== scope) return { data, hasUpdate: false, accept: () => {} }
  const replace = snapshot.scope !== scope || (!locked && snapshot.data !== data)
  if (replace) setSnapshot({ data, scope })
  return {
    data: replace ? data : snapshot.data,
    hasUpdate: !replace && snapshot.data !== data,
    accept: () => setSnapshot({ data, scope }),
  }
}
