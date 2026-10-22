import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./perf",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: join(tmpdir(), "infranexus-playwright-perf-results"),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4174",
    launchOptions: process.env.PW_CHROME_CHANNEL
      ? { channel: process.env.PW_CHROME_CHANNEL }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
