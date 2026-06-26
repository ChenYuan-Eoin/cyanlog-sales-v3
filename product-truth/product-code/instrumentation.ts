// 应用启动监控
// Next.js Instrumentation Hook（Next.js 14+）

function hasSentryDsn() {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
}

export async function register() {
  if (!hasSentryDsn()) {
    return
  }

  // 动态导入对应的 Sentry 配置
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// 应用关闭时的清理
export async function onRequestError(err: Error, request: Request, context: unknown) {
  // 双重记录：Sentry + 本地 error_logs
  const { logError } = await import('./lib/error-log')
  const extraContext =
    typeof context === 'object' && context !== null
      ? (context as Record<string, unknown>)
      : context === undefined
        ? {}
        : { context }

  await logError({
    level: 'error',
    source: 'api',
    message: err.message,
    error: err,
    context: {
      url: request.url,
      runtime: process.env.NEXT_RUNTIME,
      ...extraContext,
    },
  })
}
