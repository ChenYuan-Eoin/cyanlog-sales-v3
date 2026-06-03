// SpaceX级客户端错误监控
// SENTRY_DSN 从环境变量读取，不硬编码

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    // 性能采样：生产环境 10%，开发 100%
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // 错误采样：全量
    sampleRate: 1.0,

    // 会话重放（用户行为回放，用于复现Bug）
    replaysSessionSampleRate: 0.01, // 1% 会话
    replaysOnErrorSampleRate: 1.0,   // 100% 错误会话

    // 脱敏：确保不收集敏感信息
    beforeSend(event) {
      // 移除可能包含敏感信息的请求头
      if (event.request?.headers) {
        delete event.request.headers['authorization']
        delete event.request.headers['cookie']
      }

      // 移除 URL 中的 token 参数
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/token=[^&]+/gi, 'token=[REDACTED]')
      }

      return event
    },

    // 忽略预期内的错误
    ignoreErrors: [
      // 用户取消请求
      'AbortError',
      'CanceledError',
      // 网络中断（已用 error_logs 记录）
      'Network Error',
      'Failed to fetch',
      // 浏览器扩展干扰
      /^chrome-extension/,
      /^webkit-masked-url/,
    ],

    // 面包屑：记录用户操作路径
    beforeBreadcrumb(breadcrumb, hint) {
      // 只保留关键面包屑类型
      const usefulTypes = ['navigation', 'click', 'xhr', 'fetch', 'error']
      if (!usefulTypes.includes(breadcrumb.category || '')) {
        return null
      }
      return breadcrumb
    },
  })
} else {
  console.warn('[Sentry] DSN not configured, error tracking disabled')
}
