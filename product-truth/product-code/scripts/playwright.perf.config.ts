import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: '**/perf-100sku.perf.ts',
  workers: 1,
  timeout: 120000,
  use: { baseURL: 'http://localhost:3100', channel: 'chrome' },
})
