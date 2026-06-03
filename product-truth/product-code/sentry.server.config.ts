// SpaceX级服务端错误监控

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    // 服务端采样率
    tracesSampleRate: 0.1,
    sampleRate: 1.0,

    // 服务端特定的面包屑
    beforeSend(event) {
      // 确保不记录敏感环境变量
      if (event.contexts?.env) {
        delete event.contexts.env
      }

      // 脱敏错误消息中的密钥
      if (event.exception?.values) {
        event.exception.values.forEach((value) => {
          if (value.stacktrace?.frames) {
            value.stacktrace.frames.forEach((frame) => {
              if (frame.vars) {
                Object.keys(frame.vars).forEach((key) => {
                  if (/key|token|secret|password|hash/i.test(key)) {
                    frame.vars[key] = '[REDACTED]'
                  }
                })
              }
            })
          }
        })
      }

      return event
    },
  })
} else {
  console.warn('[Sentry] DSN not configured, server error tracking disabled')
}
