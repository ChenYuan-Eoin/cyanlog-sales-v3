import type { NextRequest } from 'next/server'

import { logError as persistErrorLog } from '@/lib/error-log'

export interface RequestLogContext {
  route: string
  requestId?: string
  userId?: string
  details?: Record<string, unknown>
}

export function getRequestId(req?: NextRequest | Request): string | undefined {
  return req?.headers.get('x-vercel-id')
    ?? req?.headers.get('x-request-id')
    ?? undefined
}

export function logRouteStart(context: RequestLogContext) {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'start',
    route: context.route,
    requestId: context.requestId,
    userId: context.userId,
    ...context.details,
  }))
}

export function logRouteDone(context: RequestLogContext, startedAt: number, details?: Record<string, unknown>) {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'done',
    route: context.route,
    requestId: context.requestId,
    userId: context.userId,
    ms: Date.now() - startedAt,
    ...context.details,
    ...details,
  }))
}

export async function logRouteFailure(
  req: NextRequest | undefined,
  context: RequestLogContext,
  startedAt: number,
  error: unknown,
  details?: Record<string, unknown>
) {
  const message = error instanceof Error ? error.message : String(error)

  console.error(JSON.stringify({
    level: 'error',
    msg: 'failed',
    route: context.route,
    requestId: context.requestId,
    userId: context.userId,
    ms: Date.now() - startedAt,
    error: message,
    ...context.details,
    ...details,
  }))

  await persistErrorLog({
    req,
    source: 'api',
    userId: context.userId,
    message,
    error,
    context: {
      route: context.route,
      requestId: context.requestId,
      ...context.details,
      ...details,
    },
  })
}
