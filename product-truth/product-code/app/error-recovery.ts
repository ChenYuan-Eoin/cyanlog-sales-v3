'use client'

import * as Sentry from '@sentry/nextjs'

import { primeHomeInitialData } from '@/lib/home-data-client'

type HomeRecoveryRouter = {
  prefetch: (href: string) => void
}

function readSessionToken() {
  try {
    return localStorage.getItem('token')
  } catch {
    return null
  }
}

function defer(callback: () => void) {
  const timer = window.setTimeout(callback, 0)
  return () => window.clearTimeout(timer)
}

function reportBoundaryError(error: Error & { digest?: string }) {
  const body = JSON.stringify({
    kind: 'error',
    message: error.message,
    stack: error.stack,
    context: {
      digest: error.digest,
      source: 'error-boundary',
    },
  })

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon('/api/client-errors', blob)) {
      return
    }
  }

  void fetch('/api/client-errors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  }).catch(() => {
    // Ignore reporting failures in the boundary itself.
  })
}

export function warmHomeRecovery(router: HomeRecoveryRouter) {
  router.prefetch('/')
  primeHomeInitialData(readSessionToken())
}

export function scheduleBoundaryReport(error: Error & { digest?: string }) {
  return defer(() => {
    Sentry.captureException(error, {
      tags: {
        source: 'error-boundary',
      },
    })

    reportBoundaryError(error)
  })
}
