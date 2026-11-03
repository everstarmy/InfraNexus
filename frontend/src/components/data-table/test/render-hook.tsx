import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
export function renderHook<T>(hook: () => T) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let current: T
  function Probe(): ReactNode {
    current = hook()
    return null
  }
  act(() => root.render(<Probe />))
  return {
    get current() {
      return current!
    },
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
  }
}
