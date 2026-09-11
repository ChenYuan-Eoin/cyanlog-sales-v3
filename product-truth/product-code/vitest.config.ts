import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Next preserves JSX; transform it for component interaction tests.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      'e2e/**',
      'playwright-report/**',
      'test-results/**',
      '.next/**',
    ],
  },
})
