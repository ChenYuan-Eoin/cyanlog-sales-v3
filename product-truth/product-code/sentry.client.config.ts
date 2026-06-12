// Sentry 客户端配置 - 最小可行：错误 + 性能
// 会话回放已移除（减少 bundle 大小）

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    // 性能采样：生产 10%，开发 100%
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // 错误采样：全量
    sampleRate: 1.0,

    // 脱敏
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['authorization']
        delete event.request.headers['cookie']
      }
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/token=[^&]+/gi, 'token=[REDACTED]')
      }
      return event
    },

    // 忽略预期错误
    ignoreErrors: [
      'AbortError',
      'Network Error',
      'Failed to fetch',
      /^chrome-extension/,
    ],
  })
} else {
  console.warn('[Sentry] DSN not configured, error tracking disabled')
}
