import { useLayoutEffect, useRef, type RefObject } from "react"
import { useLocation, useNavigationType } from "react-router-dom"

export function useMainScroll(ref: RefObject<HTMLElement | null>) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positions = useRef(new Map<string, number>())
  const previous = useRef({ key: location.key, pathname: location.pathname })

  useLayoutEffect(() => {
    const main = ref.current
    if (!main) return
    const saved = positions.current
    const prior = previous.current
    const target = navigationType === "POP"
      ? (saved.get(location.key) ?? 0)
      : prior.pathname === location.pathname ? (saved.get(prior.key) ?? 0) : 0
    previous.current = { key: location.key, pathname: location.pathname }
    saved.set(location.key, target)
    let restoring = true
    let observer: ResizeObserver | undefined
    const record = () => {
      if (!restoring) saved.set(location.key, main.scrollTop)
    }
    const stop = () => {
      restoring = false
      observer?.disconnect()
      saved.set(location.key, main.scrollTop)
    }
    const restore = () => {
      if (!restoring) return
      main.scrollTo({ top: target, behavior: "instant" })
      if (main.scrollHeight - main.clientHeight >= target) stop()
    }
    // The module fallback and async data may initially be shorter than the page.
    observer = new ResizeObserver(restore)
    if (main.firstElementChild) observer.observe(main.firstElementChild)
    main.addEventListener("scroll", record, { passive: true })
    main.addEventListener("wheel", stop, { passive: true })
    main.addEventListener("touchstart", stop, { passive: true })
    main.addEventListener("pointerdown", stop, { passive: true })
    main.addEventListener("keydown", stop)
    restore()
    return () => {
      observer?.disconnect()
      main.removeEventListener("scroll", record)
      main.removeEventListener("wheel", stop)
      main.removeEventListener("touchstart", stop)
      main.removeEventListener("pointerdown", stop)
      main.removeEventListener("keydown", stop)
    }
  }, [location.key, location.pathname, navigationType, ref])
}
