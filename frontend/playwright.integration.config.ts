import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './integration', workers: 1, fullyParallel: false,
  outputDir: join(tmpdir(), 'infranexus-integration-results'), reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.INFRANEXUS_SMOKE_BASE_URL || 'http://127.0.0.1:4175',
    channel: process.env.PW_CHROME_CHANNEL || undefined,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.INFRANEXUS_SMOKE_BASE_URL ? undefined : { command: 'node ../scripts/smoke-server.mjs', url: 'http://127.0.0.1:4175/login',
    reuseExistingServer: false, timeout: 120000, gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 } },
})
