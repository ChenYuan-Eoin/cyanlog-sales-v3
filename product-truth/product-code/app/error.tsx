'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

import { Button } from '@/components/ui/button'

async function reportBoundaryError(error: Error & { digest?: string }) {
  try {
    await fetch('/api/client-errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'error',
        message: error.message,
        stack: error.stack,
        context: {
          digest: error.digest,
          source: 'error-boundary',
        },
      }),
      keepalive: true,
    })
  } catch {
    // Ignore reporting failures in the boundary itself.
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: {
        source: 'error-boundary',
      },
    })

    void reportBoundaryError(error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">页面发生错误</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          错误已记录。请重试当前操作；如果问题持续存在，再查看 `error_logs` 或 Sentry 事件。
        </p>
        <div className="mt-4 flex gap-3">
          <Button onClick={reset}>重试</Button>
          <Button variant="outline" onClick={() => window.location.assign('/')}>返回首页</Button>
        </div>
      </div>
    </div>
  )
}
