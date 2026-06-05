'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

type ClientErrorPayload = {
  kind: 'error' | 'unhandledrejection' | 'chunk-load'
  message: string
  stack?: string
  context?: Record<string, unknown>
}

function reportClientError(payload: ClientErrorPayload) {
  const body = JSON.stringify({
    ...payload,
    path: window.location.pathname,
    href: window.location.href,
  })

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon('/api/client-errors', blob)
    return
  }

  void fetch('/api/client-errors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  })
}

function normalizeError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(fallbackMessage)
}

export function ClientErrorMonitor() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = event.message || 'Unknown client error'
      const error = normalizeError(event.error, message)
      const chunkLoad = /chunk|loading css chunk|dynamically imported module/i.test(message)

      Sentry.captureException(error, {
        tags: {
          source: 'client',
          kind: chunkLoad ? 'chunk-load' : 'error',
        },
      })

      reportClientError({
        kind: chunkLoad ? 'chunk-load' : 'error',
        message,
        stack: error.stack,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection'
      const error = normalizeError(reason, message)
      const chunkLoad = /chunk|dynamically imported module/i.test(message)

      Sentry.captureException(error, {
        tags: {
          source: 'client',
          kind: chunkLoad ? 'chunk-load' : 'unhandledrejection',
        },
      })

      reportClientError({
        kind: chunkLoad ? 'chunk-load' : 'unhandledrejection',
        message,
        stack: error.stack,
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  return null
}
