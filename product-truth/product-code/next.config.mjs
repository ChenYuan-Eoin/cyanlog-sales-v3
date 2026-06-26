/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withSentryConfig } from '@sentry/nextjs'

const appRoot = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  outputFileTracingRoot: appRoot,
}

// Sentry 配置（仅在 DSN 配置时启用）
const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.SENTRY_DSN, // 无 DSN 时静默
  hideSourceMaps: true,
  widenClientFileUpload: true,
  transpileClientSDK: true,
  tunnelRoute: '/monitoring',
  disableLogger: process.env.NODE_ENV === 'development',
}

export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig
