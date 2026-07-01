import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://localhost:3000'

/**
 * Playwright E2E 配置
 * 覆盖 3 条核心路径：登录、配置中心、报价中心
 *
 * 使用说明：
 *   1. 首次跑前需下载浏览器：pnpm exec playwright install
 *   2. 默认使用本地开发服务器（pnpm dev），但可通过 BASE_URL 覆盖
 *   3. CI 中默认不跑（标记为 optional），按需启用
 */
export default defineConfig({
  testDir: './e2e',
  // 默认 30s 超时，覆盖整个测试用例
  timeout: 30_000,
  // 期望超时：5s（元素出现的等待时间）
  expect: { timeout: 5_000 },
  // 失败重试：本地 0 次，CI 1 次
  retries: process.env.CI ? 1 : 0,
  // 串行运行（避免共享数据库状态冲突）
  workers: 1,
  // 报告：HTML + list
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    // 不在 trace 中记录密码等敏感信息
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 本地开发时自动启动 dev server
  webServer: process.env.CI || process.env.BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
