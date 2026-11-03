// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DataTableRowActions } from "./data-table-row-actions"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it("hides unauthorized entries and prevents inline actions bubbling into rows", () => {
  const selected = vi.fn(),
    parent = vi.fn()
  expect(
    renderToStaticMarkup(
      <DataTableRowActions
        row={{ id: 1 }}
        actions={[{ key: "x", label: "隐藏", hidden: true, onSelect: selected }]}
      />,
    ),
  ).toBe("")
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      <div onClick={parent}>
        <DataTableRowActions
          row={{ id: 1 }}
          maxInline={1}
          actions={[{ key: "edit", label: "编辑", onSelect: selected }]}
        />
      </div>,
    ),
  )
  act(() => host.querySelector("button")!.click())
  expect(selected).toHaveBeenCalledWith({ id: 1 })
  expect(parent).not.toHaveBeenCalled()
  act(() => root.unmount())
  host.remove()
})
