import { test, expect } from "@playwright/test"
import { cpus, platform, arch } from "node:os"
import { writeFileSync } from "node:fs"
test("data-table production measurements", async ({ page, browser }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const results = []
  for (const sample of [
    { rows: 100, cols: 20 },
    { rows: 10000, cols: 20 },
    { rows: 100, cols: 100 },
    { rows: 5000, cols: 20, tree: true },
  ].filter(
    (sample) => !process.env.TABLE_PERF_SMALL || (sample.rows === 100 && sample.cols === 20),
  )) {
    const runs = []
    for (let run = 0; run < 3; run++) {
      const start = Date.now()
      await page.goto(
        `/perf/data-table/index.html?${process.env.TABLE_VIRTUAL ? "virtual=1&" : ""}${new URLSearchParams(Object.entries(sample).map(([key, value]) => [key, String(value)]))}`,
      )
      await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible({ timeout: 90000 })
      const startupMs = Date.now() - start
      const latency = []
      for (let i = 0; i < 10; i++) {
        latency.push(
          await page.evaluate(
            async (id) => {
              const start = performance.now()
              document.getElementById(id)!.click()
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              )
              return performance.now() - start
            },
            i % 2 ? "select" : "sort",
          ),
        )
      }
      const viewLatency: number[] = []
      for (let i = 0; i < 10; i++)
        viewLatency.push(
          await page.evaluate(async () => {
            const start = performance.now()
            document.getElementById("view")!.click()
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            )
            return performance.now() - start
          }),
        )
      if (process.env.TABLE_VIRTUAL || (sample.rows === 100 && sample.cols === 20))
        expect([...viewLatency].sort((a, b) => a - b)[9]).toBeLessThan(200)
      const ordered = [...latency].sort((a, b) => a - b)
      if (process.env.TABLE_VIRTUAL || (sample.rows === 100 && sample.cols === 20)) {
        expect(ordered[Math.ceil(ordered.length * 0.95) - 1]).toBeLessThan(200)
      }
      if (process.env.TABLE_VIRTUAL) {
        expect(ordered[Math.ceil(ordered.length * 0.95) - 1]).toBeLessThan(200)
        expect(await page.locator("tbody tr[data-row-id]").count()).toBeLessThan(80)
      }
      await expect(page.locator("tbody tr[data-row-id]").first()).toHaveAttribute(
        "data-row-id",
        sample.tree ? "row-4950" : `row-${sample.rows - 1}`,
      )
      runs.push({
        startupMs,
        latency,
        viewLatency,
        nodes: await page.locator("*").count(),
        rows: await page.locator("tbody tr[data-row-id]").count(),
      })
    }
    results.push({ sample, runs })
  }
  const report = {
    environment: {
      browser: browser.version(),
      cpu: cpus()[0].model,
      platform: platform(),
      arch: arch(),
    },
    results,
  }
  writeFileSync(
    process.env.TABLE_PERF_REPORT ?? "/tmp/data-table-baseline.json",
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report))
  expect(errors).toEqual([])
})

test("virtual rows: dynamic height, sticky columns, focus, anchors and compatibility", async ({
  page,
}) => {
  await page.goto("/perf/data-table/index.html?rows=1000&cols=20&virtual=1&dynamic=1&interactive=1")
  const rows = page.locator("tbody tr[data-row-id]")
  const viewport = page.getByRole("region", { name: "表格数据" })
  await expect(rows.first()).toHaveAttribute("data-row-id", "row-0")
  await expect(page.locator("table")).toHaveAttribute("aria-rowcount", "1001")
  expect(await rows.count()).toBeLessThan(50)
  const first = rows.first().getByRole("button")
  await first.focus()
  await viewport.evaluate((el) => {
    el.scrollTop = 15000
    el.scrollLeft = 500
  })
  await expect(first).toBeFocused()
  await page.locator("#sort").focus()
  await expect.poll(async () => rows.first().getAttribute("data-row-id")).not.toBe("row-0")
  expect(await rows.count()).toBeLessThan(50)
  const anchor = await viewport.evaluate((el) => {
    const origin =
      el.getBoundingClientRect().top + el.querySelector("thead")!.getBoundingClientRect().height
    return Array.from(el.querySelectorAll<HTMLElement>("tr[data-row-id]")).find(
      (row) => row.getBoundingClientRect().bottom > origin,
    )!.dataset.rowId!
  })
  await page.locator("#insert").click()
  await expect(page.locator(`tr[data-row-id="${anchor}"]`)).toBeInViewport()
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.locator('tr[data-row-id="row-998"]')).toBeInViewport()
  await page.getByRole("button", { name: "切换分页兼容模式" }).click()
  await expect(rows).toHaveCount(100)
  await expect(page.locator("table")).not.toHaveAttribute("data-virtualized")
  await page.getByRole("button", { name: "切换虚拟滚动" }).click()
  await expect(page.locator("table")).toHaveAttribute("data-virtualized", "true")
  expect(await rows.count()).toBeLessThan(50)
})

test("virtual tree expands and collapses; unsupported details give explicit fallback", async ({
  page,
}) => {
  await page.goto("/perf/data-table/index.html?rows=5000&cols=20&tree=1&virtual=1&interactive=1")
  await expect(page.locator("table")).toHaveAttribute("aria-rowcount", "5001")
  await page.getByRole("button", { name: "Item 00000", exact: true }).click()
  await expect(page.locator("table")).toHaveAttribute("aria-rowcount", "4952")
  await page.getByRole("button", { name: "Item 00000", exact: true }).click()
  await expect(page.locator("table")).toHaveAttribute("aria-rowcount", "5001")
  await page.goto("/perf/data-table/index.html?rows=100&cols=20&virtual=1&detail=1")
  await expect(page.getByText(/虚拟滚动未启用：行详情/)).toBeVisible()
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(100)
})

test("virtual mount disposal releases DOM and reports heap trend", async ({ page, context }) => {
  await page.goto("/perf/data-table/index.html?rows=10000&cols=20&virtual=1")
  const cdp = await context.newCDPSession(page)
  const samples = []
  for (let i = 0; i < 12; i++) {
    await expect(page.locator("table")).toBeVisible()
    expect(await page.locator("tbody tr[data-row-id]").count()).toBeLessThan(80)
    await page.locator("#mount").click()
    await expect(page.locator("table")).toHaveCount(0)
    await cdp.send("HeapProfiler.collectGarbage")
    samples.push(await cdp.send("Runtime.getHeapUsage"))
    await page.locator("#mount").click()
  }
  // Warm-up excluded; tolerate engine bookkeeping, reject per-mount retention.
  expect(samples.at(-1)!.usedSize - samples[3].usedSize).toBeLessThan(4 * 1024 * 1024)
  writeFileSync("/tmp/data-table-memory.json", JSON.stringify(samples, null, 2))
})

test("shift selection includes offscreen rows and remount restores position", async ({ page }) => {
  await page.goto("/perf/data-table/index.html?rows=1000&cols=20&virtual=1&selection=1")
  const viewport = page.getByRole("region", { name: "表格数据" })
  await page.locator('tr[data-row-id="row-0"]').getByRole("checkbox").click()
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page
    .locator('tr[data-row-id="row-999"]')
    .getByRole("checkbox")
    .click({ modifiers: ["Shift"] })
  await expect(page.getByText(/已选.*1000/).first()).toBeVisible()
  await viewport.evaluate((el) => {
    el.scrollTop = 15000
  })
  await expect
    .poll(async () => page.locator("tbody tr[data-row-id]").first().getAttribute("data-row-id"))
    .not.toBe("row-999")
  const top = await viewport.evaluate((el) => el.scrollTop)
  await page.locator("#mount").click()
  await page.locator("#mount").click()
  await expect.poll(async () => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(top - 100)
  expect(await page.locator("tbody tr[data-row-id]").count()).toBeLessThan(80)
})

test("virtual grouped headers, sticky geometry, responsive themes and keyboard", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/perf/data-table/index.html?rows=1000&cols=20&virtual=1&grouped=1&interactive=1")
  const viewport = page.getByRole("region", { name: "表格数据" })
  const head = page.locator("thead")
  const headerTop = (await head.boundingBox())!.y
  await viewport.evaluate((el) => {
    el.scrollTop = 10000
    el.scrollLeft = 500
  })
  await expect.poll(async () => (await head.boundingBox())!.y).toBeCloseTo(headerTop, 0)
  const cell = page.locator("tbody tr[data-row-id] td").first()
  await expect
    .poll(async () => {
      const box = await cell.boundingBox()
      const view = await viewport.boundingBox()
      return box && view ? Math.abs(box.x - view.x) : Infinity
    })
    .toBeLessThan(1)
  await viewport.press("Home")
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBeTruthy()
      expect(await page.locator("tbody tr[data-row-id]").count()).toBeLessThan(80)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await viewport.evaluate((el) => {
    el.scrollTop = 0
    el.scrollLeft = 0
  })
  await expect(page.locator('tr[data-row-id="row-0"]')).toBeVisible()
  await page.screenshot({ path: "/tmp/infranexus-m5-table.png", animations: "disabled" })
  expect(errors).toEqual([])
})

for (const dynamic of [false, true])
  test(`density changes retain a virtual row anchor with bounded DOM${dynamic ? " (dynamic height)" : ""}`, async ({
    page,
  }) => {
    await page.goto(
      `/perf/data-table/index.html?rows=10000&cols=20&virtual=1&interactive=1${dynamic ? "&dynamic=1" : ""}`,
    )
    const viewport = page.getByRole("region", { name: "表格数据" })
    await viewport.evaluate((el) => {
      el.scrollTop = 12000
    })
    const visibleAnchor = () =>
      viewport.evaluate((el) => {
        const top =
          el.getBoundingClientRect().top + el.querySelector("thead")!.getBoundingClientRect().height
        return Array.from(el.querySelectorAll<HTMLElement>("tr[data-row-id]")).find(
          (row) => row.getBoundingClientRect().bottom > top,
        )?.dataset.rowId
      })
    await expect.poll(visibleAnchor).toMatch(/^row-[1-9][0-9]*$/)
    if (dynamic) {
      // Establish a settled precondition: wrapped rows finish their initial
      // ResizeObserver measurements before this test starts changing density.
      await expect
        .poll(() =>
          viewport.evaluate(async (el) => {
            const snapshot = () =>
              `${el.scrollTop}:${Array.from(el.querySelectorAll<HTMLElement>("tr[data-row-id]"))
                .map((row) => `${row.dataset.rowId}:${row.getBoundingClientRect().height}`)
                .join(",")}`
            const before = snapshot()
            for (let frame = 0; frame < 4; frame++)
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            return snapshot() === before
          }),
        )
        .toBe(true)
    }
    const id = await visibleAnchor()
    await page.getByRole("button", { name: "表格密度" }).click()
    await page.getByRole("menuitemradio", { name: "宽松" }).click()
    await page.keyboard.press("Escape")
    await expect(page.locator(`tr[data-row-id="${id}"]`)).toBeInViewport()
    expect(await page.locator("tbody tr[data-row-id]").count()).toBeLessThan(60)
    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(page.locator('tr[data-row-id="row-9999"]')).toBeInViewport()
  })

test("stability supplementary production measurements", async ({ page, browser }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const results = []
  for (const sample of [
    { name: "ordinary-page", query: "rows=1000&cols=20&pageSize=20&interactive=1", mounted: 20 },
    {
      name: "complex-cells",
      query: "rows=10000&cols=20&virtual=1&dynamic=1&interactive=1",
      mounted: undefined,
    },
    {
      name: "density-refresh",
      query: "rows=10000&cols=20&virtual=1&interactive=1",
      mounted: undefined,
    },
  ]) {
    const runs = []
    for (let run = 0; run < 3; run++) {
      const start = Date.now()
      await page.goto(`/perf/data-table/index.html?${sample.query}`)
      await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible()
      const startupMs = Date.now() - start
      const refreshMs = await page.evaluate(async () => {
        const start = performance.now()
        document.getElementById("refresh")!.click()
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        return performance.now() - start
      })
      await page.getByRole("button", { name: "表格密度" }).click()
      const densityStart = Date.now()
      await page.getByRole("menuitemradio", { name: "紧凑" }).click()
      await expect(page.locator('[data-slot="data-table"]')).toHaveAttribute(
        "data-density",
        "compact",
      )
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      const densityMs = Date.now() - densityStart
      const mounted = await page.locator("tbody tr[data-row-id]").count()
      if (sample.mounted) expect(mounted).toBe(sample.mounted)
      else expect(mounted).toBeLessThan(80)
      runs.push({ startupMs, refreshMs, densityMs, mounted })
    }
    results.push({ sample, runs })
  }
  writeFileSync(
    process.env.TABLE_STABILITY_REPORT ?? "/tmp/data-table-stability-supplement.json",
    JSON.stringify(
      {
        environment: {
          browser: browser.version(),
          cpu: cpus()[0].model,
          platform: platform(),
          arch: arch(),
        },
        results,
      },
      null,
      2,
    ),
  )
  expect(errors).toEqual([])
})
