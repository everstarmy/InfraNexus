import { defineConfig, devices } from "@playwright/test"
export default defineConfig({
  testDir: "./perf",
  testMatch: "data-table.spec.ts",
  workers: 1,
  outputDir: "/tmp/infranexus-table-perf",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4175",
    channel: process.env.PW_CHROME_CHANNEL,
  },
  webServer: {
    command:
      "npm run preview -- --outDir dist-table-perf --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175/perf/data-table/index.html",
    reuseExistingServer: false,
  },
})
